import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type { ChildSocketClient } from "../ipc/ChildSocketClient";
import { GetAgentResultParams, GetAgentResultResult } from "../ipc/messages";
import { Tool } from "./Tool";
import { ToolRenderer } from "./ToolRenderer";

const NO_CLIENT_ERROR = { error: "Not available in orchestrator mode" };

export class GetAgentResultTool extends Tool {
  readonly name = "get_agent_result";
  readonly label = "Get Agent Result";
  readonly description =
    "Check if a previously dispatched agent has completed. " +
    "Returns the agent's current status and result if available.";

  readonly parameters = Type.Object({
    agentIdentifier: Type.String({ description: "Agent identifier returned by spawn_agent" }),
  });

  renderShell = "self";
  renderCall = ToolRenderer.getAgentResultCall;
  renderResult = ToolRenderer.getAgentResultResult;

  constructor(private client: ChildSocketClient | null) {
    super();
  }

  async execute(
    _toolCallId: string,
    params: GetAgentResultParams,
  ): Promise<AgentToolResult<GetAgentResultResult | { error: string }>> {
    if (!this.client) {
      return {
        content: [{ type: "text", text: JSON.stringify(NO_CLIENT_ERROR) }],
        details: NO_CLIENT_ERROR,
      };
    }

    try {
      const result = await this.client.request("get_agent_result", params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    } catch (error) {
      const errorMessage = { error: error instanceof Error ? error.message : String(error) };
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(errorMessage),
          },
        ],
        details: errorMessage,
      };
    }
  }
}
