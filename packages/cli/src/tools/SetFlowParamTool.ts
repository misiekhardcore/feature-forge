import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Tool } from "@feature-forge/core";
import { ActiveFlowRegistry } from "@feature-forge/core/src/flows/ActiveFlowRegistry";
import { Type } from "typebox";

import type { TypedEventBus } from "../orchestrator/eventBus";

const SetFlowParamParams = Type.Object({
  key: Type.String({ description: "Session key to set", minLength: 1 }),
  value: Type.String({ description: "Value to store" }),
});

export class SetFlowParamTool extends Tool {
  readonly name = "set_flow_param";
  readonly label = "Set Flow Param";
  readonly description =
    "Set a flow-level session parameter that persists across routine calls of the active flow";
  readonly parameters = SetFlowParamParams;

  // Literal type required: passed directly to pi.registerTool().
  renderShell = "self" as const;

  constructor(
    private readonly activeFlow: ActiveFlowRegistry,
    private readonly eventBus: TypedEventBus,
  ) {
    super();
  }

  async execute(
    _toolCallId: string,
    params: { key: string; value: string },
    signal: AbortSignal | undefined,
  ): Promise<AgentToolResult<unknown>> {
    signal?.throwIfAborted();
    const store = this.activeFlow.getStore();
    if (!store) {
      throw new Error(
        `set_flow_param: no active flow — start a flow first (e.g. /forge:implement)`,
      );
    }
    store.set(params.key, params.value);
    this.eventBus.emit("feature-forge:session-set", {
      phase: "session-set",
      message: `Session param set: ${params.key}: ${params.value}`,
      details: { key: params.key, value: params.value },
    });
    return {
      content: [{ type: "text", text: `Session param set: ${params.key}: ${params.value}` }],
      details: undefined,
    };
  }
}
