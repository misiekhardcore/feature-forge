import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type { ChildSocketClient } from "../ipc/ChildSocketClient";
import { SpawnAgentParams, SpawnAgentResult } from "../ipc/messages";
import { logger } from "../logging";
import { Tool } from "./Tool";
import { ToolRenderer } from "./ToolRenderer";

const NO_CLIENT_ERROR = { error: "Not available in orchestrator mode" };

/**
 * Schema for the spawn_agent tool — single unambiguous mode.
 *
 * All values are fully resolved before they reach the IPC layer:
 * `systemPrompt` is the complete persona text, `prompt` is an optional
 * initial task. No template variables or spec name lookups.
 */
export const SpawnAgentParameters = Type.Object({
  role: Type.String({
    description: "Display role name for the spawned agent.",
  }),
  systemPrompt: Type.String({
    description: "Resolved persona text sent as the system prompt (no placeholders).",
  }),
  prompt: Type.Optional(
    Type.String({
      description: "Optional initial task the agent should execute immediately.",
    }),
  ),
  tools: Type.Readonly(
    Type.Array(Type.String(), {
      description: "Tool names to grant the agent.",
    }),
  ),
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
    "Create a sub-agent with a label, system prompt, and optional initial task. " +
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
