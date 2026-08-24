import * as fs from "node:fs";
import * as path from "node:path";
// ESM polyfill: __dirname is not available in ESM
import { fileURLToPath } from "node:url";

import type { ExtensionCommandContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
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
  ForgeInitCommand,
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
import { ActiveFlowRegistry } from "./orchestrator/ActiveFlowRegistry";
import { createStepExecutorRegistry } from "./orchestrator/createStepExecutorRegistry";
import { TypedEventBus } from "./orchestrator/eventBus";
import { FlowRegistrar } from "./orchestrator/FlowRegistrar";
import { CommandRegistry, ToolRegistry } from "./registry";
import { withForgePrefix } from "./registry/CommandRegistry";
import {
  DestroyAgentTool,
  GetAgentResultTool,
  ListAgentsTool,
  SendTaskTool,
  SetFlowParamTool,
  SetSessionNameTool,
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
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  // Register a minimal /forge:init command plus an optional session_start
  // notice so the user can recover when the extension cannot fully load.
  const registerDegradedMode = (noticeText: string): void => {
    const initCommand = new ForgeInitCommand({ pi });
    const registeredName = withForgePrefix(initCommand.name);
    const { name: _declaredName, ...commandOptions } = initCommand;
    pi.registerCommand(registeredName, {
      ...commandOptions,
      handler: (args: string, ctx: ExtensionCommandContext) => initCommand.handler(args, ctx),
    });

    if (!process.env.FORGE_PARENT_SOCKET) {
      pi.on("session_start", async () => {
        pi.sendMessage({
          customType: "forge_notice",
          content: [{ type: "text", text: noticeText }],
          display: true,
        });
      });
    }
  };

  // ── Configuration ─────────────────────────────────────────────────
  try {
    await ForgeConfig.create({ cwd: process.cwd() });
  } catch (error) {
    logger.warn("[feature-forge] Failed to load configuration", { error });
    registerDegradedMode(
      `Feature Forge could not load its configuration — ${
        error instanceof Error ? error.message : String(error)
      }. Run /forge:init to repair, then restart pi.`,
    );
    return;
  }

  // ── Logging ────────────────────────────────────────────────────────
  FileLogger.initialize();

  // Shared mutable env that PiSubprocessAgentFactory reads lazily.
  // Start the server first, then write the socket path here so spawned
  // children receive FORGE_PARENT_SOCKET in their process environment.
  const childEnv: Record<string, string> = {};

  const forgeConfig = ForgeConfig.getInstance();
  const forgeDir = forgeConfig.getForgeDir();

  const forgeAgentsDir = path.join(forgeDir, "agents");
  if (!fs.existsSync(forgeAgentsDir)) {
    // Degraded mode: the forge directory has not been scaffolded yet.
    // Register only /forge:init so the user can initialize, then skip
    // the rest of the extension setup (agents, flows, tools, IPC).
    registerDegradedMode(
      `Feature Forge is not initialized — ${forgeAgentsDir} does not exist. ` +
        "Run /forge:init to scaffold agents, flows, and skills, then restart pi.",
    );

    logger.warn(
      `[feature-forge] Forge not initialized — ${forgeAgentsDir} does not exist. ` +
        "Run /forge:init to scaffold agents, flows, and skills.",
    );
    return;
  }

  const specRegistry = new SpecRegistry();
  const specLoader = new SpecLoader();
  const specManager = new SpecManager(specRegistry, specLoader);
  await specManager.loadFromDirectory(forgeAgentsDir);

  // Load additional agent specs from directories configured in forge.config
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
      cliPath: forgeConfig.getPiCli(),
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
  // Contribute bundled CLI skills and .forge/skills/ to the main session's
  // skill discovery so default and project-local skills are available to
  // the in-session orchestrator.
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

  // Shared event bus and active-flow tracking, used by tools, flow
  // registration, and the flow commands. Created once per extension load.
  const eventBus = new TypedEventBus(pi.events);
  const activeFlowRegistry = new ActiveFlowRegistry();

  const toolRegistry = new ToolRegistry(client, pi);
  toolRegistry.registerAll(
    SpawnAgentTool,
    SendTaskTool,
    GetAgentResultTool,
    ListAgentsTool,
    DestroyAgentTool,
  );
  toolRegistry.registerInstance(new SetSessionNameTool(pi));
  toolRegistry.registerInstance(new SetFlowParamTool(activeFlowRegistry, eventBus));

  const cmdRegistry = new CommandRegistry(
    supervisor,
    pi,
    specManager,
    toolRegistry,
    workspaceManager,
    worktreeRegistry,
    activeFlowRegistry,
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
    ForgeInitCommand,
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
    workspaceManager,
  );

  // ── Flow-based orchestration commands ────────────────────────────
  const flowDirs = [path.join(forgeDir, "flows"), ...forgeConfig.getFlowDirectories()];
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
    eventBus,
    activeFlowRegistry,
  });
  await flowRegistrar.registerAll();

  registerDevTestCommands(pi, toolRegistry);
};

export default featureForgeExtension;
