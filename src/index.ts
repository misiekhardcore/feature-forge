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
  ResearchCommand,
  WorktreeDestroyCommand,
  WorktreeListCommand,
} from "./commands";
import { OrchestratorCommand } from "./commands/OrchestratorCommand";
import { ChildSocketClient } from "./ipc/ChildSocketClient";
import { ParentSocketServer } from "./ipc/ParentSocketServer";
import { FileLogger } from "./logging";
import {
  AgentStepExecutor,
  CleanupStepExecutor,
  FlowLoader,
  LoopStepExecutor,
  ParallelStepExecutor,
  RoutineExecutor,
  RoutineTool,
  ShellStepExecutor,
  StepExecutorRegistry,
  WorkspaceStepExecutor,
} from "./orchestrator";
import { CommandRegistry, ToolRegistry } from "./registry";
import {
  DestroyAgentTool,
  GetAgentResultTool,
  ListAgentsTool,
  SendTaskTool,
  SpawnAgentTool,
} from "./tools";
import { GitWorktreeProvider, WorkspaceManager, WorktreeRegistry } from "./workspace";

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
  const logger = FileLogger.initialize();

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

  // ── Flow orchestrator wiring ────────────────────────────────────────

  const flowsDir = path.join(__dirname, "flows");
  const flowLoader = new FlowLoader(flowsDir);

  const stepExecutorRegistry = new StepExecutorRegistry().registerAll(
    new WorkspaceStepExecutor(workspaceManager),
    new AgentStepExecutor(supervisor, specManager),
    new ParallelStepExecutor(),
    new LoopStepExecutor(),
    new CleanupStepExecutor(workspaceManager),
    new ShellStepExecutor(),
  );

  try {
    const implementFlow = await flowLoader.load("implement");
    const routineExecutor = new RoutineExecutor(implementFlow, stepExecutorRegistry);

    for (const routineName of Object.keys(implementFlow.routines)) {
      const routineTool = new RoutineTool(routineName, implementFlow, routineExecutor);
      toolRegistry.registerInstance(routineTool);
    }

    const orchestratorCmd = new OrchestratorCommand(
      supervisor,
      pi,
      specManager,
      "implement",
      flowsDir,
      workspaceManager,
    );

    // CommandRegistry.register uses constructors with a standard signature;
    // OrchestratorCommand has extra constructor params (flowName, flowsDir).
    // Register directly via pi to avoid needing a registerInstance method.
    pi.registerCommand(orchestratorCmd.name, {
      ...orchestratorCmd,
      handler: (args: string, ctx: Parameters<typeof orchestratorCmd.handler>[1]) =>
        orchestratorCmd.handler(args, ctx),
    });
  } catch (error) {
    // Flow loading failure is non-fatal at init — the extension still
    // starts with the remaining commands/tools. The error is logged so
    // operators can diagnose missing or invalid flow packages.
    logger.error("Failed to load flow package", {
      error: error instanceof Error ? error.message : String(error),
    });
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
