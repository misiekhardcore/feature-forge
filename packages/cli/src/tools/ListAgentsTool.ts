import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Tool } from "@feature-forge/shared";
import { logger } from "@feature-forge/shared";
import { Type } from "typebox";

import type { ChildSocketClient } from "../ipc/ChildSocketClient";
import { ListAgentsResult } from "../ipc/messages";
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

  async execute(
    _toolCallId: string,
    _params: Record<string, never>,
    signal: AbortSignal | undefined,
    _onUpdate: AgentToolUpdateCallback<ListAgentsResult | { error: string }> | undefined,
    _ctx: ExtensionContext,
  ): Promise<AgentToolResult<ListAgentsResult | { error: string }>> {
    if (!this.client) {
      signal?.throwIfAborted();
      return {
        content: [{ type: "text", text: JSON.stringify(NO_CLIENT_ERROR) }],
        details: NO_CLIENT_ERROR,
      };
    }

    signal?.throwIfAborted();

    try {
      const result = await this.client.request("list_agents", {}, undefined, signal);
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
