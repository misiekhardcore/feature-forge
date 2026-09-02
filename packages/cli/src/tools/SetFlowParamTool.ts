import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Tool } from "@feature-forge/core";
import type { TypedEventBus } from "@feature-forge/core/event-bus";
import { ActiveFlowRegistry } from "@feature-forge/core/flows";
import type { Static } from "typebox";
import { Type } from "typebox";

import { ToolRenderer } from "../tui/views/ToolRenderer";

const SetFlowParamParams = Type.Object({
  key: Type.String({ description: "Session key to set", minLength: 1 }),
  value: Type.String({ description: "Value to store" }),
});

export class SetFlowParamTool extends Tool<typeof SetFlowParamParams> {
  readonly name = "set_flow_param";
  readonly label = "Set Flow Param";
  readonly description =
    "Set a flow-level session parameter that persists across routine calls of the active flow";
  readonly parameters = SetFlowParamParams;

  // Literal type required: passed directly to pi.registerTool().
  renderShell = "self" as const;

  renderCall = ToolRenderer.setFlowParamCall;
  renderResult = ToolRenderer.setFlowParamResult;

  constructor(
    private readonly activeFlow: ActiveFlowRegistry,
    private readonly eventBus: TypedEventBus,
  ) {
    super();
  }

  async execute(
    _toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
  ): Promise<AgentToolResult<unknown>> {
    signal?.throwIfAborted();
    const { key, value } = params as Static<typeof SetFlowParamParams>;
    const store = this.activeFlow.getStore();
    if (!store) {
      throw new Error(
        `set_flow_param: no active flow — start a flow first (e.g. /forge:implement)`,
      );
    }
    store.set(key, value);
    this.eventBus.emit("feature-forge:session-set", {
      phase: "session-set",
      message: `Session param set: ${key}: ${value}`,
      details: { key, value },
    });
    return {
      content: [{ type: "text", text: `Session param set: ${key}: ${value}` }],
      details: undefined,
    };
  }
}
