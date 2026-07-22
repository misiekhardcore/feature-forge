import type {
  AccumulatedState,
  DisplayContribution,
  DisplayContributionRegistry,
} from "@feature-forge/tui";

import type { TypedEventBus } from "../eventBus";
import type { FlowContext } from "../FlowContext";
import type { FlowInstruction, SessionInstruction } from "../FlowInstruction";
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

  async execute(
    instruction: SessionInstruction,
    context: FlowContext,
    _executeStep: (
      instruction: FlowInstruction,
      context: FlowContext,
      signal?: AbortSignal,
    ) => Promise<FlowContext>,
    eventBus: TypedEventBus,
    _signal?: AbortSignal,
  ): Promise<FlowContext> {
    const resolvedKey = context.resolve(instruction.key);
    const resolvedValue = context.resolve(instruction.value);
    context.store.set(resolvedKey, resolvedValue);
    eventBus.emit("feature-forge:session-set", {
      phase: "session-set",
      message: `Session param set: ${resolvedKey}: ${resolvedValue}`,
      details: { key: resolvedKey, value: resolvedValue },
    });
    return context;
  }

  override getDisplayContribution(event: RoutineProgressEvent): DisplayContribution | undefined {
    if (event.phase === "session-set") {
      return {
        type: "session",
        params: { [event.details.key]: event.details.value },
        phase: event.phase,
        message: event.message,
      };
    }
    return undefined;
  }

  override registerDisplayHandler(registry: DisplayContributionRegistry): void {
    registry.register("session", (state: AccumulatedState, contribution) => {
      if (contribution.type !== "session") return;
      const entries = Object.entries(contribution.params);
      const snippet = entries.map(([k, v]) => `${k}: ${v}`).join(", ");
      state.resultSnippet = state.resultSnippet ? `${state.resultSnippet}, ${snippet}` : snippet;
    });
  }
}
