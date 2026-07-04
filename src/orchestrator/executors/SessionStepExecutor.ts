import type { EventBus } from "@earendil-works/pi-coding-agent";

import type { FlowContext } from "../FlowContext";
import type { FlowInstruction, SessionInstruction } from "../FlowInstruction";
import { StepExecutor } from "../StepExecutor";

/**
 * Executes a `session` instruction by writing a key/value pair into
 * the flow-global session on {@link FlowContext}.
 *
 * The session persists across routine calls — values written by one
 * routine are available to all subsequent routines via `{{session.<key>}}`
 * template resolution.
 */
export class SessionStepExecutor extends StepExecutor<SessionInstruction> {
  readonly type = "session";

  async execute(
    instruction: SessionInstruction,
    context: FlowContext,
    _executeStep: (
      instruction: FlowInstruction,
      context: FlowContext,
      signal?: AbortSignal,
    ) => Promise<FlowContext>,
    _eventBus: EventBus,
    _signal?: AbortSignal,
  ): Promise<FlowContext> {
    return context.withSessionValue(instruction.key, instruction.value);
  }
}
