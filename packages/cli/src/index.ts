import * as path from "node:path";

import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";

// Re-export public config API

export * from "./config";

import {
  InMemoryAgentSupervisor,
  PiSubprocessAgentFactory,
  SpecManager,
  SpecRegistry,
} from "./agents";
import {
  AgentDestroyAllCommand,
  AgentDestroyCommand,
  AgentListCommand,
  FlowExitCommand,
  ResearchCommand,
  WorktreeDestroyCommand,
  WorktreeListCommand,
} from "./commands";
import { ForgeConfig } from "./config";
import { activateForgeSkills } from "./extensions/forge-skills";
import { registerDevTestCommands } from "./extensions/registerTestCommands";
import { activateSpecResolution } from "./extensions/spec-resolution";
import { connectChildClient } from "./ipc/connectChildClient";
import { ParentSocketServer } from "./ipc/ParentSocketServer";
import { SpecLoader } from "./loaders";
import { FileLogger, logger } from "./logging";
import { createStepExecutorRegistry } from "./orchestrator/createStepExecutorRegistry";
import { TypedEventBus } from "./orchestrator/eventBus";
import { FlowRegistrar } from "./orchestrator/FlowRegistrar";
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
  // ── Configuration ─────────────────────────────────────────────────
  await ForgeConfig.create({ cwd: process.cwd() });

  // ── Logging ────────────────────────────────────────────────────────
  FileLogger.initialize();

  // Shared mutable env that PiSubprocessAgentFactory reads lazily.
  // Start the server first, then write the socket path here so spawned
  // children receive FORGE_PARENT_SOCKET in their process environment.
  const childEnv: Record<string, string> = {};

  const specRegistry = new SpecRegistry();
  const specLoader = new SpecLoader();
  const specManager = new SpecManager(specRegistry, specLoader);
  await specManager.loadFromDirectory(path.join(__dirname, "agents", "declarative-specs"));

  // Load additional agent specs from directories configured in forge.config
  const forgeConfig = ForgeConfig.getInstance()!;
  for (const agentSpecDir of forgeConfig.getAgentSpecDirectories()) {
    try {
      await specManager.loadFromDirectory(agentSpecDir);
    } catch (error) {
      logger.warn("[feature-forge] Failed to load agent specs from config directory", {
        dir: agentSpecDir,
        error,
      });
    }
  }

  const factory = new PiSubprocessAgentFactory({
    env: childEnv,
    cwd: process.cwd(),
  });
  const supervisor = new InMemoryAgentSupervisor(factory);
  const ipcServer = new ParentSocketServer(supervisor, pi, specManager);
  const socketPath = await ipcServer.start();
  childEnv.FORGE_PARENT_SOCKET = socketPath;
  const targetSocketPath = process.env.FORGE_PARENT_SOCKET ?? socketPath;

  // ── Child-side spec resolution ────────────────────────────────────
  // When FORGE_SPEC is set (child process receives full spec as JSON),
  // resolve and apply tools, system prompt, tool restrictions, and
  // thinking level from the spec locally.
  activateSpecResolution(pi);

  // ── Forge skill discovery ────────────────────────────────────────
  // Contribute .forge/skills/ to the main session's skill discovery
  // so project-local skills are available to the in-session orchestrator.
  activateForgeSkills(pi);

  // Every session runs as a client.
  // Child sessions: FORGE_PARENT_SOCKET points to the parent's server.
  // Root parent: no env var, so connect to our own server (loopback).
  // connectChildClient also forwards agent_update push events to the user.
  const client = await connectChildClient(targetSocketPath, pi);

  // Set up worktree infrastructure
  const repoRoot = process.cwd();
  const worktreeProvider = new GitWorktreeProvider(repoRoot);
  const worktreeRegistry = new WorktreeRegistry();
  await worktreeRegistry.load();
  const workspaceManager = new WorkspaceManager(worktreeProvider, worktreeRegistry);

  const toolRegistry = new ToolRegistry(client, pi);
  toolRegistry.registerAll(
    SpawnAgentTool,
    SendTaskTool,
    GetAgentResultTool,
    ListAgentsTool,
    DestroyAgentTool,
  );

  const cmdRegistry = new CommandRegistry(
    supervisor,
    pi,
    specManager,
    toolRegistry,
    workspaceManager,
  );
  cmdRegistry.registerAll(
    AgentListCommand,
    AgentDestroyCommand,
    AgentDestroyAllCommand,
    FlowExitCommand,
    ResearchCommand,
    WorktreeListCommand,
    WorktreeDestroyCommand,
  );

  const workspaceProviderRegistry = new WorkspaceProviderRegistry()
    .register("git-worktree", worktreeProvider)
    .register("current-dir", new CurrentDirProvider());

  // ── Step executor registry ───────────────────────────────────────
  const stepExecutorRegistry = createStepExecutorRegistry(
    workspaceProviderRegistry,
    supervisor,
    specManager,
    worktreeRegistry,
  );

  // ── Flow-based orchestration commands ────────────────────────────
  const flowDirs = [path.join(__dirname, "flows"), ...forgeConfig.getFlowDirectories()];
  const flowRegistrar = new FlowRegistrar({
    pi,
    cmdRegistry,
    toolRegistry,
    supervisor,
    specManager,
    workspaceManager,
    flowDirs,
    knownProviders: workspaceProviderRegistry.names(),
    stepExecutorRegistry,
    eventBus: new TypedEventBus(pi.events),
  });
  await flowRegistrar.registerAll();

  registerDevTestCommands(pi, toolRegistry);
};

export default featureForgeExtension;
