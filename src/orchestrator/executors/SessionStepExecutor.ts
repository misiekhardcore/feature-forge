import type { EventBus } from "@earendil-works/pi-coding-agent";

import type { FlowContext } from "../FlowContext";
import type { FlowInstruction, SessionInstruction } from "../FlowInstruction";
import type { FlowStateStore } from "../FlowStateStore";
import type { DisplayContribution } from "../progress/DisplayContribution";
import type { RoutineProgressEvent } from "../RoutineProgress";
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

  constructor(private readonly store: FlowStateStore) {
    super();
  }

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
    context.store.set(instruction.key, instruction.value);

    _eventBus.emit("feature-forge:session-set", {
      phase: "session-set",
      message: `session: ${instruction.key}=${instruction.value}`,
      details: {
        key: instruction.key,
        value: instruction.value,
        session: context.store.toObject(),
      },
    });

    return context;
  }

  override getDisplayContribution(event: RoutineProgressEvent): DisplayContribution | undefined {
    if (event.phase !== "session-set") {
      return undefined;
    }
    const session = event.details.session;
    if (!session || typeof session !== "object") {
      return undefined;
    }
    return {
      sessionEntries: session,
      phase: event.phase,
      message: event.message,
    };
  }
}
