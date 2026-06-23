import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type { ChildSocketClient } from "../ipc/ChildSocketClient";
import { DestroyAgentParams, DestroyAgentResult } from "../ipc/messages";
import { Tool } from "./Tool";
import { ToolRenderer } from "./ToolRenderer";

const NO_CLIENT_ERROR = { error: "Not available in orchestrator mode" };

export class DestroyAgentTool extends Tool {
  readonly name = "destroy_agent";
  readonly label = "Destroy Agent";
  readonly description = "Destroy a previously spawned agent and clean up its resources.";
  readonly parameters = Type.Object({
    agentIdentifier: Type.String({ description: "Agent identifier returned by spawn_agent" }),
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
  ): Promise<AgentToolResult<DestroyAgentResult | { error: string }>> {
    if (!this.client) {
      return {
        content: [{ type: "text", text: JSON.stringify(NO_CLIENT_ERROR) }],
        details: NO_CLIENT_ERROR,
      };
    }

    try {
      const result = await this.client.request("destroy_agent", params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    } catch (error) {
      const errorDetails = { error: error instanceof Error ? error.message : String(error) };
      return {
        content: [{ type: "text", text: JSON.stringify(errorDetails) }],
        details: errorDetails,
      };
    }
  }
}
