import type { Theme } from "@earendil-works/pi-coding-agent";
import { IpcTool } from "@feature-forge/core";
import { ListAgentsResult } from "@feature-forge/core/ipc";
import type { Static } from "typebox";
import { Type } from "typebox";

import { RenderableTool, type ToolRenderContext, ToolRenderer } from "../tui/views/ToolRenderer";

const ListAgentsParameters = Type.Object({});

type ListAgentsArgs = Static<typeof ListAgentsParameters>;

export class ListAgentsTool
  extends IpcTool<typeof ListAgentsParameters, ListAgentsResult>
  implements RenderableTool<typeof ListAgentsParameters, ListAgentsResult | { error: string }>
{
  readonly name = "list_agents";
  readonly label = "List Agents";
  readonly description = "List all spawned agents and their current status.";

  readonly parameters = ListAgentsParameters;
  protected readonly messageType = "list_agents";

  renderShell = "self" as const;

  renderCall = (_args: ListAgentsArgs, theme: Theme, context: ToolRenderContext) =>
    ToolRenderer.shell(context, theme, "selectedBg", ({ line }) => {
      line(ToolRenderer.header(theme, "text", "list_agents"));
    });

  renderResult = ToolRenderer.simpleResult;
}
