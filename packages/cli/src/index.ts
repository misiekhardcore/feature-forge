import * as path from "node:path";

import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
// Re-export public config API
import { FileLogger, ForgeConfig, logger } from "@feature-forge/shared";

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
  WorktreePruneCommand,
} from "./commands";
import { activateForgeSkills } from "./extensions/forge-skills";
import { registerDevTestCommands } from "./extensions/registerTestCommands";
import { activateSpecResolution } from "./extensions/spec-resolution";
import { connectChildClient } from "./ipc/connectChildClient";
import { ParentSocketServer } from "./ipc/ParentSocketServer";
import { SpecLoader } from "./loaders";
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
import { registerSignalHandlers } from "./workspace/registerSignalHandlers";

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
  const forgeConfig = ForgeConfig.getInstance();
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

  const factory = new PiSubprocessAgentFactory(
    {
      env: childEnv,
      cwd: process.cwd(),
    },
    forgeConfig.getConfig().models,
  );
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

  // ── Signal handlers ────────────────────────────────────────────────
  // Best-effort workspace cleanup on termination signals.
  // Uses process.once() to prevent listener leaks since handlers
  // always call process.exit().
  registerSignalHandlers(workspaceManager);

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
    worktreeRegistry,
  );
  cmdRegistry.registerAll(
    AgentListCommand,
    AgentDestroyCommand,
    AgentDestroyAllCommand,
    FlowExitCommand,
    ResearchCommand,
    WorktreeListCommand,
    WorktreeDestroyCommand,
    WorktreePruneCommand,
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

  pi.registerCommand("forge:init", {
    description: "Initialize Feature Forge project scaffolding",
    handler: async (_args, ctx) => {
      const setupScript = path.join(__dirname, "..", "scripts", "forge-setup.sh");

      const scaffoldConfig = await ctx.ui.confirm(
        "Forge: Init",
        "Scaffold forge.config.json with defaults?",
      );
      const updateGitignore = await ctx.ui.confirm(
        "Forge: Init",
        "Add forge entries to .gitignore?",
      );

      const args = ["bash", setupScript];
      if (!scaffoldConfig) args.push("--no-config");
      if (!updateGitignore) args.push("--no-gitignore");
      args.push("--yes", "--cwd", process.cwd());

      try {
        await pi.exec(args[0], args.slice(1));
        ctx.ui.notify("Feature Forge initialized successfully", "info");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        ctx.ui.notify(`Setup failed: ${message}`, "error");
      }
    },
  });
};

export default featureForgeExtension;
