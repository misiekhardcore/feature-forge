import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type { ChildSocketClient } from "../ipc/ChildSocketClient";
import { SpawnAgentParams, SpawnAgentResult } from "../ipc/messages";
import { Tool } from "./Tool";
import { ToolRenderer } from "./ToolRenderer";

const NO_CLIENT_ERROR = { error: "Not available in orchestrator mode" };

export class SpawnAgentTool extends Tool {
  readonly name = "spawn_agent";
  readonly label = "Spawn Agent";
  readonly description =
    "Create a sub-agent with a specific role and system prompt. " +
    "Returns an agentIdentifier that can be used with send_task, " +
    "get_agent_result, and destroy_agent.";

  readonly parameters = Type.Object({
    role: Type.String({ description: "Agent role (e.g., researcher, reviewer, writer)" }),
    systemPrompt: Type.String({ description: "Full system prompt for the agent" }),
    toolNames: Type.Array(Type.String(), {
      description: "Tool names to grant the agent (e.g., read, bash, grep)",
    }),
    model: Type.Optional(
      Type.String({ description: "Optional model override (e.g., claude-sonnet-4-5)" }),
    ),
  });

  renderShell = "self";
  renderCall = ToolRenderer.spawnAgentCall;
  renderResult = ToolRenderer.spawnAgentResult;

  constructor(private client: ChildSocketClient | null) {
    super();
  }

  async execute(
    _toolCallId: string,
    params: SpawnAgentParams,
  ): Promise<AgentToolResult<SpawnAgentResult | { error: string }>> {
    if (!this.client) {
      return {
        content: [{ type: "text", text: JSON.stringify(NO_CLIENT_ERROR) }],
        details: NO_CLIENT_ERROR,
      };
    }

    try {
      const result = await this.client.request("spawn_agent", params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        details: result,
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
          },
        ],
        details: { error: error instanceof Error ? error.message : String(error) },
      };
    }
  }
}
