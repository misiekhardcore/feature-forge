import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { logger, Tool } from "@feature-forge/shared";
import { ToolRenderer } from "@feature-forge/tui";
import { Type } from "typebox";

import type { ChildSocketClient } from "../ipc/ChildSocketClient";
import { DestroyAgentParams, DestroyAgentResult } from "../ipc/messages";

const NO_CLIENT_ERROR = { error: "Not available in orchestrator mode" };

export class DestroyAgentTool extends Tool {
  readonly name = "destroy_agent";
  readonly label = "Destroy Agent";
  readonly description = "Destroy a previously spawned agent and clean up its resources.";
  readonly parameters = Type.Object({
    agentId: Type.String({ description: "Agent id returned by spawn_agent" }),
  });

  renderShell = "self";
  renderCall = ToolRenderer.destroyAgentCall;
  renderResult = ToolRenderer.destroyAgentResult;

  constructor(private client: ChildSocketClient | null) {
    super();
  }

  async execute(
    _toolCallId: string,
    params: DestroyAgentParams,
    signal: AbortSignal | undefined,
  ): Promise<AgentToolResult<DestroyAgentResult | { error: string }>> {
    if (!this.client) {
      signal?.throwIfAborted();
      return {
        content: [{ type: "text", text: JSON.stringify(NO_CLIENT_ERROR) }],
        details: NO_CLIENT_ERROR,
      };
    }

    signal?.throwIfAborted();

    try {
      const result = await this.client.request("destroy_agent", params, undefined, signal);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    } catch (error) {
      logger.error("Tool execution failed", { toolName: this.name, error });
      const errorDetails = { error: error instanceof Error ? error.message : String(error) };
      return {
        content: [{ type: "text", text: JSON.stringify(errorDetails) }],
        details: errorDetails,
      };
    }
  }
}
