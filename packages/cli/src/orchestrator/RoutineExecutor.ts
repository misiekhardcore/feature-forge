import { logger } from "../logging";
import type { TypedEventBus } from "./eventBus";
import type { InstructionResult } from "./FlowContext";
import { FlowContext } from "./FlowContext";
import type { FlowDefinition, FlowInstruction, RoutineDefinition } from "./FlowInstruction";
import { FlowParams, FlowStateStore } from "./FlowStateStore";
import { MaxDepthExceededError } from "./MaxDepthExceededError";
import type { RoutineResult } from "./RoutineResult";
import { StepExecutorRegistry } from "./StepExecutorRegistry";

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
   * @param depth — Optional nesting depth (incremented each time a routine calls another routine).
   *   When aborted, an {@link AbortError} propagates uncaught to the caller.
   * @returns Structured result with per-instruction outputs.
   */
  async run(
    routineName: string,
    params: FlowParams,
    task: string,
    signal?: AbortSignal,
    depth?: number,
    routineDefOverride?: RoutineDefinition,
  ): Promise<RoutineResult> {
    const routine: RoutineDefinition | undefined =
      routineDefOverride ?? this.flow.routines[routineName];
    if (!routine) {
      throw new Error(
        `Routine "${routineName}" not found in flow "${this.flow.name}". ` +
          `Available: ${Object.keys(this.flow.routines).join(", ")}`,
      );
    }

    // Guard against excessive nesting before creating the context.
    if (depth !== undefined && depth >= MaxDepthExceededError.MAX_NESTING_DEPTH) {
      throw new MaxDepthExceededError(depth);
    }

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
      depth: depth ?? 0,
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
        return this.buildFailureResult(routineName, context, err);
      }
    }

    return this.buildResult(routineName, context, true);
  }

  private buildResult(
    routineName: string,
    context: FlowContext,
    passed: boolean,
    error?: Error,
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

    // Check if any step result explicitly failed — overrides the exception-only signal.
    if (passed) {
      for (const result of Object.values(results)) {
        if (result.parsed?.passed === false) {
          passed = false;
          break;
        }
      }
    }

    const summary = RoutineExecutor.buildResultSummary(routineName, passed, error, results);

    return {
      routine: routineName,
      passed,
      session: context.store.toObject(),
      rounds: context.iteration,
      workspace,
      results,
      summary,
    };
  }

  private buildFailureResult(
    routineName: string,
    context: FlowContext,
    error: Error,
  ): RoutineResult {
    return this.buildResult(routineName, context, false, error);
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
