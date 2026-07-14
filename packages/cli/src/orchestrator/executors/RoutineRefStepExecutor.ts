import type { TypedEventBus } from "../eventBus";
import type { FlowContext } from "../FlowContext";
import type { FlowInstruction, RoutineRefInstruction } from "../FlowInstruction";
import type { DisplayContribution } from "../progress/DisplayContribution";
import type { DisplayContributionRegistry } from "../progress/DisplayContributionRegistry";
import type { RoutineProgressEvent } from "../RoutineProgress";
import { StepExecutor } from "../StepExecutor";

/**
 * Stub executor for "routine" instructions.
 *
 * Routine references allow one flow to call another flow's routine.
 * The full implementation is deferred to a follow-up subtask; this
 * stub ensures the executor type is registered so flows containing
 * routine references pass validation without crashing at runtime
 * with "No step executor registered for type routine".
 *
 * TODO: Replace with a real implementation that dispatches to the
 * target flow's routine executor and captures the result.
 */
export class RoutineRefStepExecutor extends StepExecutor<RoutineRefInstruction> {
  readonly type = "routine";

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
    const details = event.details as {
      instructionId: string;
      target: string;
      routine: string;
      passed?: boolean;
    };
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
    _instruction: RoutineRefInstruction,
    _context: FlowContext,
    _executeStep: (
      instruction: FlowInstruction,
      context: FlowContext,
      signal?: AbortSignal,
    ) => Promise<FlowContext>,
    _eventBus: TypedEventBus,
    _signal?: AbortSignal,
  ): Promise<FlowContext> {
    throw new Error(
      "RoutineRefStepExecutor is not yet implemented. " +
        "Routine reference instructions cannot be executed until a future subtask adds the full implementation.",
    );
  }
}
