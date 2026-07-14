import type { TypedEventBus } from "../eventBus";
import type { FlowContext } from "../FlowContext";
import type { FlowInstruction, RoutineRefInstruction } from "../FlowInstruction";
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
