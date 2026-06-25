import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type { ChildSocketClient } from "../ipc/ChildSocketClient";
import { SpawnAgentParams, SpawnAgentResult } from "../ipc/messages";
import { Tool } from "./Tool";
import { ToolRenderer } from "./ToolRenderer";

const NO_CLIENT_ERROR = { error: "Not available in orchestrator mode" };

// Two modes: (A) spec + specParams, or (B) role + systemPrompt.
// Must be a plain object schema — the API requires type: "object" at the root.
export const SpawnAgentParameters = Type.Object({
  toolNames: Type.Readonly(
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
  // Mode A: named spec
  spec: Type.Optional(
    Type.String({
      description: 'Mode A — named spec identifier (e.g. "build", "review", "verify", "research").',
    }),
  ),
  specParams: Type.Optional(
    Type.Record(Type.String(), Type.String(), {
      description: "Mode A — template variable values for the named spec's system prompt.",
    }),
  ),
  // Mode B: custom role
  role: Type.Optional(
    Type.String({
      description: 'Mode B — agent role (e.g. "researcher", "reviewer").',
    }),
  ),
  systemPrompt: Type.Optional(
    Type.String({
      description: "Mode B — full system prompt for the spawned agent.",
    }),
  ),
});

export class SpawnAgentTool extends Tool {
  readonly name = "spawn_agent";
  readonly label = "Spawn Agent";
  readonly description =
    "Create a sub-agent with a specific role and system prompt. " +
    "Returns an agentId for use with send_task, get_agent_result, and destroy_agent. " +
    "Two modes: provide spec + specParams (role from spec), or role + systemPrompt + toolNames (custom fallback).";

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
