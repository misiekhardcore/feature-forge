import type { AgentToolResult, Theme } from "@earendil-works/pi-coding-agent";
import { Tool } from "@feature-forge/core";
import type { TypedEventBus } from "@feature-forge/core/event-bus";
import { ActiveFlowRegistry } from "@feature-forge/core/flows";
import type { Static } from "typebox";
import { Type } from "typebox";

import { RenderableTool, type ToolRenderContext, ToolRenderer } from "../tui/views/ToolRenderer";

const SetFlowParamParams = Type.Object({
  key: Type.String({ description: "Session key to set", minLength: 1 }),
  value: Type.String({ description: "Value to store" }),
});

type SetFlowParamArgs = Static<typeof SetFlowParamParams>;

export class SetFlowParamTool extends Tool implements RenderableTool<typeof SetFlowParamParams> {
  readonly name = "set_flow_param";
  readonly label = "Set Flow Param";
  readonly description =
    "Set a flow-level session parameter that persists across routine calls of the active flow";
  readonly parameters = SetFlowParamParams;

  // Literal type required: passed directly to pi.registerTool().
  renderShell = "self" as const;

  renderCall = (args: SetFlowParamArgs, theme: Theme, context: ToolRenderContext) =>
    ToolRenderer.shell(context, theme, "toolSuccessBg", ({ line, expandable }) => {
      line(ToolRenderer.header(theme, "success", `set_flow_param ${args.key}`));
      expandable(args.value, "muted");
    });

  renderResult = ToolRenderer.messageResult;

  constructor(
    private readonly activeFlow: ActiveFlowRegistry,
    private readonly eventBus: TypedEventBus,
  ) {
    super();
  }

  async execute(
    _toolCallId: string,
    params: SetFlowParamArgs,
    signal: AbortSignal | undefined,
  ): Promise<AgentToolResult<unknown>> {
    signal?.throwIfAborted();
    const { key, value } = params;
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
