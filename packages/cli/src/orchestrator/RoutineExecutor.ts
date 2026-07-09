import type { EventBus } from "@earendil-works/pi-coding-agent";

import { logger } from "../logging";
import type { InstructionResult } from "./FlowContext";
import { FeedbackPendingError, FlowContext } from "./FlowContext";
import type { FlowDefinition, FlowInstruction, RoutineDefinition } from "./FlowInstruction";
import { FlowParams, FlowStateStore } from "./FlowStateStore";
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
    public readonly eventBus: EventBus,
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
   * @param depth — Optional nested call depth for cross-flow routine calls.
   *   Defaults to 0 for top-level routine invocations.
   * @returns Structured result with per-instruction outputs.
   */
  async run(
    routineName: string,
    params: FlowParams,
    task: string,
    signal?: AbortSignal,
    depth?: number,
  ): Promise<RoutineResult> {
    const routine: RoutineDefinition | undefined = this.flow.routines[routineName];
    if (!routine) {
      throw new Error(
        `Routine "${routineName}" not found in flow "${this.flow.name}". ` +
          `Available: ${Object.keys(this.flow.routines).join(", ")}`,
      );
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
      depth,
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
        // FeedbackPendingError: await the provider, set feedback, and retry the step.
        if (error instanceof FeedbackPendingError) {
          if (!context.feedbackProvider) {
            return this.buildFailureResult(
              routineName,
              context,
              new Error("Feedback pending but no provider configured"),
            );
          }
          const feedback = await context.feedbackProvider();
          context = context.withFeedback(feedback);
          context = await executeStep(step, context, signal);
          continue;
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

    const summary = passed
      ? `Routine "${routineName}" completed with ${Object.keys(results).length} results`
      : `Routine "${routineName}" failed: ${error?.message ?? "unknown error"}`;

    return {
      routine: routineName,
      passed,
      session: context.store.toObject(),
      rounds: context.iteration + 1,
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
}
