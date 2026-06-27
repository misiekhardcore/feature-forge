import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";

import {
  InMemoryAgentSupervisor,
  PiSubprocessAgentFactory,
  SpecManager,
  SpecRegistry,
} from "./agents";
import { SpecLoader } from "./agents/declarative-specs/SpecLoader";
import {
  AgentDestroyAllCommand,
  AgentDestroyCommand,
  AgentListCommand,
  OrchestratorCommand,
  ResearchCommand,
  WorktreeDestroyCommand,
  WorktreeListCommand,
} from "./commands";
import { ChildSocketClient } from "./ipc/ChildSocketClient";
import { ParentSocketServer } from "./ipc/ParentSocketServer";
import { FileLogger } from "./logging";
import { FlowLoader } from "./orchestrator/FlowLoader";
import { StepExecutorRegistry } from "./orchestrator/StepExecutorRegistry";
import { CommandRegistry, ToolRegistry } from "./registry";
import {
  DestroyAgentTool,
  GetAgentResultTool,
  ListAgentsTool,
  SendTaskTool,
  SpawnAgentTool,
} from "./tools";
import {
  CurrentDirProvider,
  GitWorktreeProvider,
  WorkspaceManager,
  WorkspaceProviderRegistry,
  WorktreeRegistry,
} from "./workspace";

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
  // ── Logging ────────────────────────────────────────────────────────
  FileLogger.initialize();

  // Shared mutable env that PiSubprocessAgentFactory reads lazily.
  // Start the server first, then write the socket path here so spawned
  // children receive FORGE_PARENT_SOCKET in their process environment.
  const childEnv: Record<string, string> = {};

  const factory = new PiSubprocessAgentFactory({
    env: childEnv,
    cwd: process.cwd(),
  });
  const specRegistry = new SpecRegistry();
  const specsDir = path.join(__dirname, "agents", "declarative-specs");
  const specLoader = new SpecLoader(specsDir);
  const specManager = new SpecManager(specRegistry, specLoader);
  await specManager.load();
  const supervisor = new InMemoryAgentSupervisor(factory);
  const ipcServer = new ParentSocketServer(supervisor, pi, specManager);
  const socketPath = await ipcServer.start();
  childEnv.FORGE_PARENT_SOCKET = socketPath;
  const targetSocketPath = process.env.FORGE_PARENT_SOCKET ?? socketPath;
  // Every session runs as a client.
  // Child sessions: FORGE_PARENT_SOCKET points to the parent's server.
  // Root parent: no env var, so connect to our own server (loopback).
  const client = await connectChildClient(targetSocketPath, pi);

  // Set up worktree infrastructure — prefer Worktrunk if available
  const repoRoot = process.cwd();
  const provider = (await WorktrunkProvider.canActivate(repoRoot))
    ? new WorktrunkProvider(repoRoot)
    : new GitWorktreeProvider(repoRoot);
  const worktreeRegistry = new WorktreeRegistry();
  await worktreeRegistry.load();
  const workspaceManager = new WorkspaceManager(provider, worktreeRegistry);

  const cmdRegistry = new CommandRegistry(supervisor, pi, specManager, workspaceManager);
  cmdRegistry.registerAll(
    AgentListCommand,
    AgentDestroyCommand,
    AgentDestroyAllCommand,
    ResearchCommand,
    WorktreeListCommand,
    WorktreeDestroyCommand,
  );

  const toolRegistry = new ToolRegistry(client, pi);
  toolRegistry.registerAll(
    SpawnAgentTool,
    SendTaskTool,
    GetAgentResultTool,
    ListAgentsTool,
    DestroyAgentTool,
  );

  // ── Workspace provider registry ──────────────────────────────────
  const workspaceProviderRegistry = new WorkspaceProviderRegistry()
    .register("git-worktree", provider)
    .register("current-dir", new CurrentDirProvider());

  // ── Step executor registry ───────────────────────────────────────
  const _stepExecutorRegistry = new StepExecutorRegistry();
  // Built-in executors are registered by another agent.
  // See TODO in src/orchestrator/RoutineTool.ts for the executor wiring.

  // ── Flow-based orchestration commands ────────────────────────────
  const flowsDir = path.join(__dirname, "flows");
  const knownSpecs = specRegistry.specNames();
  const knownProviders = workspaceProviderRegistry.names();

  let flowDirectories: string[];
  try {
    const entries = await fs.readdir(flowsDir, { withFileTypes: true });
    flowDirectories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    // flowsDir doesn't exist yet or is empty — skip flow registration silently.
    flowDirectories = [];
  }

  for (const flowName of flowDirectories) {
    const flowDir = path.join(flowsDir, flowName);

    // a. Read the orchestrator prompt from the flow directory.
    let promptContent: string;
    try {
      promptContent = await fs.readFile(path.join(flowDir, "orchestrator.md"), "utf-8");
    } catch {
      // Skip flows without an orchestrator prompt.
      continue;
    }

    // b. Load and validate the flow definition.
    const flowLoader = new FlowLoader(flowDir, knownSpecs, knownProviders);
    let flow;
    try {
      flow = await flowLoader.load("flow");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[feature-forge] Failed to load flow "${flowName}": ${message}`);
      continue;
    }

    // c. Register an OrchestratorCommand for this flow.
    const orchestratorCommand = new OrchestratorCommand(
      supervisor,
      pi,
      specManager,
      workspaceManager,
      flow,
      promptContent,
    );

    // Register directly with pi (not via CommandRegistry) because
    // OrchestratorCommand carries extra constructor params (flow + promptContent)
    // that CommandRegistry's generic constructor pattern can't provide.
    pi.registerCommand(orchestratorCommand.name, {
      description: orchestratorCommand.description,
      handler: (args: string, ctx) => orchestratorCommand.handler(args, ctx),
    });

    // d. TODO: Import and register RoutineTool once src/orchestrator/RoutineTool.ts exists.
    // import { RoutineTool } from "./orchestrator/RoutineTool";
    //
    // for (const [routineName, routineDef] of Object.entries(flow.routines)) {
    //   const routineTool = new RoutineTool(
    //     client,
    //     pi,
    //     supervisor,
    //     flowName,
    //     routineName,
    //     routineDef,
    //     workspaceProviderRegistry,
    //     stepExecutorRegistry,
    //   );
    //   toolRegistry.register(() => routineTool);
    // }
  }
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
      const { agentId, status, result } = event.payload;
      const message = `**Agent ${agentId}** — ${status}${result ? `:\n\n${result}` : ""}`;
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
