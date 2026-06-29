import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type { ChildSocketClient } from "../ipc/ChildSocketClient";
import { SpawnAgentParams, SpawnAgentResult } from "../ipc/messages";
import { logger } from "../logging";
import { Tool } from "./Tool";
import { ToolRenderer } from "./ToolRenderer";

const NO_CLIENT_ERROR = { error: "Not available in orchestrator mode" };

/**
 * Single unambiguous mode — all values are fully resolved by the caller.
 */
export const SpawnAgentParameters = Type.Object({
  label: Type.String({
    description: "Display label / role name for the agent.",
  }),
  systemPrompt: Type.String({
    description: "Resolved persona text (already filled, no placeholders).",
  }),
  prompt: Type.Optional(
    Type.String({
      description: "Optional initial task (can be sent later via send_task).",
    }),
  ),
  tools: Type.Array(Type.String(), {
    description: "Tool names to grant the agent.",
  }),
  model: Type.Optional(
    Type.String({
      description: 'Optional model preference (e.g. "claude-sonnet-4-5").',
    }),
  ),
  cwd: Type.Optional(
    Type.String({
      description: "Optional working directory.",
    }),
  ),
});

export class SpawnAgentTool extends Tool {
  readonly name = "spawn_agent";
  readonly label = "Spawn Agent";
  readonly description =
    "Create a sub-agent with a label and fully resolved system prompt. " +
    "Returns an agentId for use with send_task, get_agent_result, and destroy_agent.";

  readonly parameters = SpawnAgentParameters;

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
      logger.error("Tool execution failed", { toolName: this.name, error });
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
