import { logger } from "@feature-forge/core";
import type { TypedEventBus } from "@feature-forge/core/src/event-bus";
import type { StepExecutorRegistry } from "@feature-forge/core/src/executors/StepExecutorRegistry";
import type { InstructionResult } from "@feature-forge/core/src/flows/FlowContext";
import { FlowContext } from "@feature-forge/core/src/flows/FlowContext";
import type {
  FlowDefinition,
  FlowInstruction,
  RoutineDefinition,
} from "@feature-forge/core/src/flows/FlowInstruction";
import { isContainerInstruction } from "@feature-forge/core/src/flows/FlowInstruction";
import { FlowParams, FlowStateStore } from "@feature-forge/core/src/flows/FlowStateStore";
import type { ToolRegistry } from "@feature-forge/core/src/registry/ToolRegistry";

import type { RoutineResult, RoutineStatus } from "./RoutineResult";

/**
 * Runs one routine's steps to completion using a
 * {@link StepExecutorRegistry} to dispatch each instruction.
 *
 * State is threaded through an immutable {@link FlowContext} — no shared
 * mutable state between steps.
 *
 * Usage:
 * ```typescript
 * const executor = new RoutineExecutor(flow, stepRegistry);
 * const result = await executor.run("build", { branch: "fix/bug" }, "Fix #42");
 * ```
 */
export class RoutineExecutor {
  /** Flow-global state store that survives across routine calls. */
  readonly store: FlowStateStore;

  constructor(
    private readonly flow: FlowDefinition,
    /**
     * Registry of step executors, exposed so callers (e.g. RoutineTool)
     * can iterate executors for display-contribution extraction.
     */
    public readonly stepRegistry: StepExecutorRegistry,
    public readonly eventBus: TypedEventBus,
    public readonly toolRegistry: ToolRegistry,
    store?: FlowStateStore,
  ) {
    this.store = store ?? new FlowStateStore();
  }

  /**
   * Execute every step in the named routine and return a structured result.
   *
   * @param routineName — Must exist in {@link flow.routines}.
   * @param params — Key-value pairs exposed as `{{PARAM}}` tokens.
   * @param task — Top-level task description, exposed as `{{prompt}}`.
   * @param signal — Optional abort signal for cancelling the routine mid-execution.
   *   When aborted, an {@link AbortError} propagates uncaught to the caller.
   * @returns Structured result with per-instruction outputs.
   */
  async run(
    routineName: string,
    params: FlowParams,
    task: string,
    signal?: AbortSignal,
    routineDefOverride?: RoutineDefinition,
  ): Promise<RoutineResult> {
    // The schema-static routine shape (Type.Static<FlowDefinitionSchema>) types
    // `steps` as the loose instruction union, wider than the explicit
    // `RoutineDefinition` contract (container steps: FlowInstruction[]) — the
    // cast narrows it; undefined is handled by the guard below.
    const routine: RoutineDefinition | undefined =
      routineDefOverride ??
      (this.flow.routines.find((r) => r.id === routineName) as RoutineDefinition);
    if (!routine) {
      throw new Error(
        `Routine "${routineName}" not found in flow "${this.flow.name}". ` +
          `Available: ${this.flow.routines.map((r) => r.id).join(", ")}`,
      );
    }

    // Steps declared `failFast: false` are non-blocking by contract (ADR 0008):
    // their failure is surfaced as a soft `passed:false` result but must never
    // fail the routine. This matters for loop-body steps like `sync` — a failed
    // git fetch on the final iteration would otherwise flip the whole routine
    // to `passed:false` despite builder/review/verify all passing.
    const nonBlockingIds = RoutineExecutor.collectNonBlockingIds(routine.steps);

    logger.info("Starting routine", {
      flow: this.flow.name,
      routine: routineName,
      stepCount: routine.steps.length,
    });

    // Merge session values into params — routine params override session defaults.
    const mergedParams = new Map<string, string>();
    for (const [key, value] of this.store.entries()) {
      mergedParams.set(key, value);
    }
    for (const [key, value] of Object.entries(params)) {
      mergedParams.set(key, value);
    }

    let context = new FlowContext({
      params: mergedParams,
      results: new Map(),
      prompt: task,
      store: this.store,
    });

    // Recursive step dispatcher — passes itself to executors so container
    // instructions (loop, parallel) can dispatch their children without
    // depending on the StepExecutorRegistry directly.
    const executeStep = async (
      instruction: FlowInstruction,
      ctx: FlowContext,
      stepSignal?: AbortSignal,
    ): Promise<FlowContext> => {
      const effectiveSignal = stepSignal ?? signal;
      const executor = this.stepRegistry.get(instruction.type);
      if (!executor) {
        throw new Error(
          `No step executor registered for type "${instruction.type}" ` +
            `(routine "${routineName}", step "${instruction.id}")`,
        );
      }
      return executor.execute(instruction, ctx, executeStep, this.eventBus, effectiveSignal);
    };

    for (const step of routine.steps) {
      // Check abort signal before each step so the routine can be cancelled
      // without waiting for the current step to complete.
      signal?.throwIfAborted();

      logger.debug("Executing step", {
        routine: routineName,
        step: step.id,
        type: step.type,
      });

      try {
        context = await executeStep(step, context, signal);
      } catch (error) {
        // AbortError propagates uncaught — do not convert to a failure result.
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error("Step execution failed", {
          routine: routineName,
          step: step.id,
          type: step.type,
          error: err,
        });
        return this.buildFailureResult(routineName, context, err, nonBlockingIds);
      }
    }

    return this.buildResult(routineName, context, true, undefined, nonBlockingIds);
  }

  /**
   * Collect the ids of every step declared `failFast: false`, walking into
   * container instructions (loop, parallel) recursively. Results for these
   * ids are excluded from the routine-level failure check in
   * {@link buildResult}.
   */
  private static collectNonBlockingIds(
    steps: FlowInstruction[],
    acc: Set<string> = new Set(),
  ): Set<string> {
    for (const step of steps) {
      if (step.type === "shell" && step.failFast === false) {
        acc.add(step.id);
      }
      if (isContainerInstruction(step)) {
        RoutineExecutor.collectNonBlockingIds(step.steps, acc);
      }
    }
    return acc;
  }

  private buildResult(
    routineName: string,
    context: FlowContext,
    passed: boolean,
    error?: Error,
    nonBlockingIds: ReadonlySet<string> = new Set(),
  ): RoutineResult {
    const results: Record<string, InstructionResult> = {};
    for (const [key, value] of context.results) {
      results[key] = value;
    }

    // Backwards-compat: single-workspace flows expect `workspace` on the
    // top-level result. Multi-workspace flows should read workspace paths
    // from `results` directly.
    const workspaceEntry = [...context.workspaces.entries()][0];
    const workspace = workspaceEntry ? workspaceEntry[1].path : undefined;

    // Check if any step result explicitly failed — overrides the exception-only
    // signal. Results from `failFast: false` steps are skipped: those steps are
    // non-blocking by design and their soft failure is informational only.
    if (passed) {
      for (const [id, result] of Object.entries(results)) {
        if (nonBlockingIds.has(id)) {
          continue;
        }
        if (result.parsed?.passed === false) {
          passed = false;
          break;
        }
      }
    }

    // Derive the three-state status. "failed" wins over "skipped": a routine
    // that both skipped a step and failed a step reports "failed".
    let status: RoutineStatus = "success";
    let reason: string | undefined;
    if (!passed) {
      status = "failed";
    } else {
      const skippedIds = RoutineExecutor.collectSkippedIds(results);
      if (skippedIds.length > 0) {
        status = "skipped";
        reason = `Skipped step(s): ${skippedIds.join(", ")}`;
      }
    }

    const summary = RoutineExecutor.buildResultSummary(routineName, passed, error, results);

    return {
      routine: routineName,
      passed,
      status,
      reason,
      session: context.store.toObject(),
      rounds: context.iteration,
      workspace,
      results,
      summary,
    };
  }

  /**
   * Collect the ids of every step whose result carries the structured
   * {@link InstructionResult.skipped} flag (set by executors that produce a
   * "skipped" outcome, e.g. a loop skipped by its while-guard). These drive
   * the "skipped" routine status. Detection is structural — the raw output
   * string is never inspected.
   */
  private static collectSkippedIds(results: Record<string, InstructionResult>): string[] {
    const skipped: string[] = [];
    for (const [id, result] of Object.entries(results)) {
      if (result.skipped) {
        skipped.push(id);
      }
    }
    return skipped;
  }

  private buildFailureResult(
    routineName: string,
    context: FlowContext,
    error: Error,
    nonBlockingIds: ReadonlySet<string> = new Set(),
  ): RoutineResult {
    return this.buildResult(routineName, context, false, error, nonBlockingIds);
  }

  private static buildResultSummary(
    routineName: string,
    passed: boolean,
    error: Error | undefined,
    results: Record<string, unknown>,
  ): string {
    if (passed) {
      return `Routine "${routineName}" completed with ${Object.keys(results).length} results`;
    }
    if (error) {
      return `Routine "${routineName}" failed: ${error.message}`;
    }
    return `Routine "${routineName}" failed — step result(s) not passed`;
  }
}
