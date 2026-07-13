import type { TypedEventBus } from "../eventBus";
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
    _eventBus: TypedEventBus,
    _signal?: AbortSignal,
  ): Promise<FlowContext> {
    const resolvedKey = context.resolve(instruction.key);
    const resolvedValue = context.resolve(instruction.value);
    context.store.set(resolvedKey, resolvedValue);
    return context;
  }
}
