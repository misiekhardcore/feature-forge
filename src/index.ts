import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

import { InMemoryAgentSupervisor, PiSubprocessAgentFactory } from "./agents";
import {
  AgentDestroyAllCommand,
  AgentDestroyCommand,
  AgentListCommand,
  ResearchCommand,
} from "./commands";
import { ChildSocketClient } from "./ipc/ChildSocketClient";
import { CommandRegistry, ToolRegistry } from "./registry";
import {
  DestroyAgentTool,
  GetAgentResultTool,
  ListAgentsTool,
  SendTaskTool,
  SpawnAgentTool,
} from "./tools";

/**
 * Feature Forge — autonomous software engineering platform.
 *
 * Single extension loaded by both parent and child agents.
 * Tools are registered unconditionally; socket-based tools
 * accept a null client and return a safe error in orchestrator mode.
 */
const featureForgeExtension: ExtensionFactory = async (pi) => {
  const supervisor = new InMemoryAgentSupervisor(new PiSubprocessAgentFactory());

  const cmdRegistry = new CommandRegistry(supervisor, pi);
  cmdRegistry.registerAll(
    AgentListCommand,
    AgentDestroyCommand,
    AgentDestroyAllCommand,
    ResearchCommand,
  );

  const socketPath = process.env.FORGE_PARENT_SOCKET ?? null;
  const client = socketPath ? await connectChildClient(socketPath, pi) : null;

  const toolRegistry = new ToolRegistry(client, pi);
  toolRegistry.registerAll(
    SpawnAgentTool,
    SendTaskTool,
    GetAgentResultTool,
    ListAgentsTool,
    DestroyAgentTool,
  );
};

/**
 * Connect to the parent's Unix socket and wire up push event forwarding.
 */
async function connectChildClient(
  socketPath: string,
  pi: ExtensionAPI,
): Promise<ChildSocketClient> {
  const client = new ChildSocketClient(socketPath);
  await client.connect();

  // Forward async agent update events to the user
  client.onPush((event) => {
    if (event.type === "agent_update") {
      const { agentIdentifier, status, result } = event.payload;
      const message = `**Agent ${agentIdentifier}** — ${status}${result ? `:\n\n${result}` : ""}`;
      pi.sendMessage({
        customType: "agent_update",
        content: [{ type: "text", text: message }],
        display: true,
        details: event.payload,
      });
    }
  });

  return client;
}

export default featureForgeExtension;
