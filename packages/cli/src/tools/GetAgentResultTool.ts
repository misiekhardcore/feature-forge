import type { Theme } from "@earendil-works/pi-coding-agent";
import { IpcTool } from "@feature-forge/core";
import { GetAgentResultResult } from "@feature-forge/core/ipc";
import type { Static } from "typebox";
import { Type } from "typebox";

import { RenderableTool, type ToolRenderContext, ToolRenderer } from "../tui/views/ToolRenderer";

const GetAgentResultParameters = Type.Object({
  agentId: Type.String({ description: "Agent id returned by spawn_agent" }),
});

type GetAgentResultArgs = Static<typeof GetAgentResultParameters>;

export class GetAgentResultTool
  extends IpcTool<typeof GetAgentResultParameters, GetAgentResultResult>
  implements
    RenderableTool<typeof GetAgentResultParameters, GetAgentResultResult | { error: string }>
{
  readonly name = "get_agent_result";
  readonly label = "Get Agent Result";
  readonly description =
    "Check if a previously dispatched agent has completed. " +
    "Returns the agent's current status and result if available.";

  readonly parameters = GetAgentResultParameters;
  protected readonly messageType = "get_agent_result";

  renderShell = "self" as const;

  renderCall = (args: GetAgentResultArgs, theme: Theme, context: ToolRenderContext) =>
    ToolRenderer.shell(context, theme, "customMessageBg", ({ line }) => {
      line(ToolRenderer.header(theme, "warning", `get_agent_result ${args.agentId}`));
    });

  renderResult = ToolRenderer.simpleResult;
}
