import { IpcTool } from "@feature-forge/shared";
import { ToolRenderer } from "@feature-forge/tui";
import { Type } from "typebox";

import { ListAgentsResult } from "../ipc/messages";

const ListAgentsParameters = Type.Object({});

export class ListAgentsTool extends IpcTool<typeof ListAgentsParameters, ListAgentsResult> {
  readonly name = "list_agents";
  readonly label = "List Agents";
  readonly description = "List all spawned agents and their current status.";

  readonly parameters = ListAgentsParameters;
  protected readonly messageType = "list_agents";

  renderShell = "self";
  renderCall = ToolRenderer.listAgentsCall;
  renderResult = ToolRenderer.listAgentsResult;
}
