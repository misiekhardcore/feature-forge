import { IpcTool } from "@feature-forge/core";
import { GetAgentResultResult } from "@feature-forge/core/src/ipc/messages";
import { Type } from "typebox";

import { ToolRenderer } from "../tui/views/ToolRenderer";

const GetAgentResultParameters = Type.Object({
  agentId: Type.String({ description: "Agent id returned by spawn_agent" }),
});

export class GetAgentResultTool extends IpcTool<
  typeof GetAgentResultParameters,
  GetAgentResultResult
> {
  readonly name = "get_agent_result";
  readonly label = "Get Agent Result";
  readonly description =
    "Check if a previously dispatched agent has completed. " +
    "Returns the agent's current status and result if available.";

  readonly parameters = GetAgentResultParameters;
  protected readonly messageType = "get_agent_result";

  renderShell = "self";
  renderCall = ToolRenderer.getAgentResultCall;
  renderResult = ToolRenderer.getAgentResultResult;
}
