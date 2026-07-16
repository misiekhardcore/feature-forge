import { logger } from "../../logging";
import type { TypedEventBus } from "../eventBus";
import type { FlowContext, InstructionResult } from "../FlowContext";
import type { FlowDefinition, FlowInstruction, RoutineRefInstruction } from "../FlowInstruction";
import { MaxDepthExceededError } from "../MaxDepthExceededError";
import type { DisplayContribution } from "../progress/DisplayContribution";
import type { DisplayContributionRegistry } from "../progress/DisplayContributionRegistry";
import { RoutineExecutor } from "../RoutineExecutor";
import type { RoutineProgressEvent } from "../RoutineProgress";
import { StepExecutor } from "../StepExecutor";
import type { StepExecutorRegistry } from "../StepExecutorRegistry";
import { isAbortError } from "./isAbortError";

/**
 * Error thrown when a routine reference instruction references a non-existent
 * target flow or routine.
 */
export class RoutineRefLookupError extends Error {
  readonly name = "RoutineRefLookupError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

/**
 * Executes a "routine" instruction that references a routine in another flow.
 *
 * The executor looks up the target flow from a registry of known flows,
 * creates a child {@link RoutineExecutor}, dispatches the target routine
 * with incremented depth, and records the result.
 */
export class RoutineRefStepExecutor extends StepExecutor<RoutineRefInstruction> {
  readonly type = "routine";

  constructor(
    private readonly params: {
      /** Registry of known flows, keyed by command (e.g. "/implement"). */
      flowMap: Map<string, FlowDefinition>;
      /** Registry of step executors shared across flows. */
      stepRegistry: StepExecutorRegistry;
    },
  ) {
    super();
  }

  /**
   * Register a handler that appends routine reference entries
   * (in "target:routine" format) to {@code state.routineRefs}.
   */
  override registerDisplayHandler(registry: DisplayContributionRegistry): void {
    registry.register("routine-ref", (state, contribution) => {
      if (contribution.type !== "routine-ref") return;
      const entry = `${contribution.target}:${contribution.routine}`;
      state.routineRefs ??= [];
      state.routineRefs.push(entry);
    });
  }

  /**
   * Extract routine-ref display info from a progress event.
   */
  override getDisplayContribution(event: RoutineProgressEvent): DisplayContribution | undefined {
    if (
      event.phase !== "routine-ref-start" &&
      event.phase !== "routine-ref-done" &&
      event.phase !== "routine-ref-error"
    ) {
      return undefined;
    }

    // Now we have a discriminated union.
    // Extract the common properties of routine-ref phases.
    const details = event.details;
    const status =
      event.phase === "routine-ref-start"
        ? "started"
        : event.phase === "routine-ref-done"
          ? "done"
          : "error";
    return {
      type: "routine-ref",
      target: details.target,
      routine: details.routine,
      status,
      phase: event.phase,
      message: event.message,
    };
  }

  async execute(
    instruction: RoutineRefInstruction,
    context: FlowContext,
    _executeStep: (
      instruction: FlowInstruction,
      context: FlowContext,
      signal?: AbortSignal,
    ) => Promise<FlowContext>,
    eventBus: TypedEventBus,
    signal?: AbortSignal,
  ): Promise<FlowContext> {
    signal?.throwIfAborted();

    const outputKey = instruction.output_as ?? instruction.id;

    // 1. Guard against excessive nesting depth.
    if (context.depth >= MaxDepthExceededError.MAX_NESTING_DEPTH) {
      const error = new MaxDepthExceededError(context.depth);
      eventBus.emit("feature-forge:routine-ref-error", {
        phase: "routine-ref-error",
        message: error.message,
        details: {
          instructionId: instruction.id,
          target: instruction.target,
          routine: instruction.routine ?? "main",
        },
      });
      throw error;
    }

    // 2. Lookup target flow.
    const targetFlow = this.params.flowMap.get(instruction.target);
    if (!targetFlow) {
      return this.handleFailure(
        instruction,
        context,
        eventBus,
        `Target flow "${instruction.target}" not found. Available flows: ${[...this.params.flowMap.keys()].join(", ")}`,
        outputKey,
      );
    }

    // 3. Lookup target routine.
    const routineName = instruction.routine ?? "main";
    const targetRoutine = targetFlow.routines[routineName];
    if (!targetRoutine) {
      return this.handleFailure(
        instruction,
        context,
        eventBus,
        `Routine "${routineName}" not found in flow "${instruction.target}". ` +
          `Available: ${Object.keys(targetFlow.routines).join(", ")}`,
        outputKey,
      );
    }

    // 4. Emit routine-ref-start.
    eventBus.emit("feature-forge:routine-ref-start", {
      phase: "routine-ref-start",
      message: `Referencing routine "${routineName}" in flow "${instruction.target}"`,
      details: {
        instructionId: instruction.id,
        target: instruction.target,
        routine: routineName,
      },
    });

    // 5. Resolve input params.
    const resolvedInput: Record<string, string> = {};
    if (instruction.input) {
      for (const [key, value] of Object.entries(instruction.input)) {
        resolvedInput[key] = context.resolve(value);
      }
    }

    // 6. Set up timeout via AbortController if instruction.timeout is set.
    const instructionTimeout = instruction.timeout;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutController = instructionTimeout !== undefined ? new AbortController() : undefined;

    // Combine the parent signal and the timeout signal.
    const { signal: combinedSignal, cleanup: cleanupSignals } = this.combineSignals(
      signal,
      timeoutController?.signal,
    );

    if (timeoutController) {
      timeoutHandle = setTimeout(() => {
        timeoutController.abort();
      }, instructionTimeout! * 1000);
    }

    try {
      // 7. Create child RoutineExecutor and dispatch the target routine.
      const childExecutor = new RoutineExecutor(
        targetFlow,
        this.params.stepRegistry,
        eventBus,
        context.store,
      );

      const routineResult = await childExecutor.run(
        routineName,
        resolvedInput,
        context.prompt,
        context.depth + 1,
        combinedSignal,
      );

      // 8. Emit routine-ref-done.
      eventBus.emit("feature-forge:routine-ref-done", {
        phase: "routine-ref-done",
        message: `Routine "${routineName}" in flow "${instruction.target}" completed`,
        details: {
          instructionId: instruction.id,
          target: instruction.target,
          routine: routineName,
          passed: routineResult.passed,
        },
      });

      // 9. Store result.
      const result: InstructionResult = {
        raw: JSON.stringify(routineResult),
        parsed: {
          passed: routineResult.passed,
          summary: routineResult.summary,
        },
      };

      return context.withResult(outputKey, result);
    } catch (error) {
      // 10. Catch errors: re-throw MaxDepthExceededError / AbortError.
      if (error instanceof MaxDepthExceededError || isAbortError(error)) {
        throw error;
      }

      const err = error instanceof Error ? error : new Error(String(error));
      return this.handleOnError(instruction, context, eventBus, err, outputKey);
    } finally {
      // 11. Clear timeout and remove signal listeners.
      cleanupSignals();
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  // ── Private helpers ─────────────────────────────────────────

  /**
   * Handle a lookup failure (missing flow or routine) according to the
   * instruction's `on_error` policy.
   *
   * When `on_error` is "continue", returns a failed result context.
   * Otherwise throws a {@link RoutineRefLookupError}.
   */
  private handleFailure(
    instruction: RoutineRefInstruction,
    context: FlowContext,
    eventBus: TypedEventBus,
    message: string,
    outputKey: string,
  ): FlowContext {
    const error = new RoutineRefLookupError(message);

    eventBus.emit("feature-forge:routine-ref-error", {
      phase: "routine-ref-error",
      message: error.message,
      details: {
        instructionId: instruction.id,
        target: instruction.target,
        routine: instruction.routine ?? "main",
      },
    });

    if (instruction.on_error === "continue") {
      const result: InstructionResult = {
        raw: error.message,
        parsed: {
          passed: false,
          summary: error.message,
        },
      };
      return context.withResult(outputKey, result);
    }

    throw error;
  }

  /**
   * Handle a runtime error from the child routine execution according to
   * the instruction's `on_error` policy.
   *
   * When `on_error` is "continue", returns a failed result context.
   * Otherwise re-throws the error.
   */
  private handleOnError(
    instruction: RoutineRefInstruction,
    context: FlowContext,
    eventBus: TypedEventBus,
    error: Error,
    outputKey: string,
  ): FlowContext {
    logger.error("Routine ref execution failed", {
      instructionId: instruction.id,
      target: instruction.target,
      routine: instruction.routine ?? "main",
      error,
    });

    eventBus.emit("feature-forge:routine-ref-error", {
      phase: "routine-ref-error",
      message: error.message,
      details: {
        instructionId: instruction.id,
        target: instruction.target,
        routine: instruction.routine ?? "main",
      },
    });

    if (instruction.on_error === "continue") {
      const result: InstructionResult = {
        raw: error.message,
        parsed: {
          passed: false,
          summary: error.message,
        },
      };
      return context.withResult(outputKey, result);
    }

    throw error;
  }

  /**
   * Combine an optional parent signal and an optional timeout signal into
   * a single {@link AbortSignal} that aborts when either source aborts.
   *
   * Returns `{ signal, cleanup }` where `signal` is `undefined` when
   * neither signal source is provided. The `cleanup` function MUST be
   * called in a `finally` block to remove event listeners from the
   * source signals.
   */
  private combineSignals(
    parentSignal: AbortSignal | undefined,
    timeoutSignal: AbortSignal | undefined,
  ): { signal: AbortSignal | undefined; cleanup: () => void } {
    if (!parentSignal && !timeoutSignal) return { signal: undefined, cleanup: () => {} };
    if (parentSignal && !timeoutSignal) return { signal: parentSignal, cleanup: () => {} };
    if (!parentSignal && timeoutSignal) return { signal: timeoutSignal, cleanup: () => {} };

    // Both signals exist — create a composite.
    const controller = new AbortController();
    const onAbort = () => controller.abort();

    parentSignal!.addEventListener("abort", onAbort, { once: true });
    timeoutSignal!.addEventListener("abort", onAbort, { once: true });

    // If either is already aborted, abort immediately.
    if (parentSignal!.aborted || timeoutSignal!.aborted) {
      controller.abort();
    }

    const cleanup = () => {
      parentSignal!.removeEventListener("abort", onAbort);
      timeoutSignal!.removeEventListener("abort", onAbort);
    };

    return { signal: controller.signal, cleanup };
  }
}
