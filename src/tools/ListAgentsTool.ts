import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type { ChildSocketClient } from "../ipc/ChildSocketClient";
import { ListAgentsResult } from "../ipc/messages";
import { logger } from "../logging";
import { Tool } from "./Tool";
import { ToolRenderer } from "./ToolRenderer";

const NO_CLIENT_ERROR = { error: "Not available in orchestrator mode" };

export class ListAgentsTool extends Tool {
  readonly name = "list_agents";
  readonly label = "List Agents";
  readonly description = "List all spawned agents and their current status.";
  readonly parameters = Type.Object({});

  renderShell = "self";
  renderCall = ToolRenderer.listAgentsCall;
  renderResult = ToolRenderer.listAgentsResult;

  constructor(private client: ChildSocketClient | null) {
    super();
  }

  async execute(): Promise<AgentToolResult<ListAgentsResult | { error: string }>> {
    if (!this.client) {
      return {
        content: [{ type: "text", text: JSON.stringify(NO_CLIENT_ERROR) }],
        details: NO_CLIENT_ERROR,
      };
    }

    try {
      const result = await this.client.request("list_agents", {});
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    } catch (error) {
      logger.error("Tool execution failed", { toolName: this.name, error });
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
