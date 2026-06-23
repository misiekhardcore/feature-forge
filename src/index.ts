import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

import { InMemoryAgentSupervisor, PiSubprocessAgentFactory } from "./agents";
import {
  AgentDestroyAllCommand,
  AgentDestroyCommand,
  AgentListCommand,
  ResearchCommand,
} from "./commands";
import { ChildSocketClient } from "./ipc/ChildSocketClient";
import { ParentSocketServer } from "./ipc/ParentSocketServer";
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
 *
 * Every session starts a ParentSocketServer (for its own children) and
 * connects as a ChildSocketClient:
 * - **Root parent**: connects to its own server via loopback. Tools send
 *   IPC to the local supervisor through the server.
 * - **Child agents**: connect to the parent's server via `FORGE_PARENT_SOCKET`
 *   (set by the parent in the child's process env). Tools send IPC to the
 *   parent's supervisor.
 *
 * This keeps a single code path — all tool calls go through IPC, whether
 * the caller is the parent or a child.
 */
const featureForgeExtension: ExtensionFactory = async (pi) => {
  // Shared mutable env that PiSubprocessAgentFactory reads lazily.
  // Start the server first, then write the socket path here so spawned
  // children receive FORGE_PARENT_SOCKET in their process environment.
  const childEnv: Record<string, string> = {};

  const factory = new PiSubprocessAgentFactory({
    env: childEnv,
    cwd: process.cwd(),
  });
  const supervisor = new InMemoryAgentSupervisor(factory);
  const ipcServer = new ParentSocketServer(supervisor, pi);
  const socketPath = await ipcServer.start();
  childEnv.FORGE_PARENT_SOCKET = socketPath;
  const targetSocketPath = process.env.FORGE_PARENT_SOCKET ?? socketPath;
  // Every session runs as a client.
  // Child sessions: FORGE_PARENT_SOCKET points to the parent's server.
  // Root parent: no env var, so connect to our own server (loopback).
  const client = await connectChildClient(targetSocketPath, pi);

  const cmdRegistry = new CommandRegistry(supervisor, pi);
  cmdRegistry.registerAll(
    AgentListCommand,
    AgentDestroyCommand,
    AgentDestroyAllCommand,
    ResearchCommand,
  );

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
