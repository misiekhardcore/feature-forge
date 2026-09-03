import * as fs from "node:fs";
import * as path from "node:path";

import type { ExtensionCommandContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
// Re-export public config API
import {
  DEFAULT_FORGE_CONFIG,
  FileLogger,
  type ForgeConfigData,
  ForgeConfigLoader,
  ForgeConfigPaths,
  logger,
} from "@feature-forge/core";
import {
  InMemoryAgentSupervisor,
  PiSubprocessAgentFactory,
  SpecManager,
  SpecRegistry,
} from "@feature-forge/core/agents";
import { SpecLoader } from "@feature-forge/core/agents";
import {
  AgentDestroyAllCommand,
  AgentDestroyCommand,
  ResearchCommand,
  WorktreeDestroyCommand,
  WorktreeListCommand,
  WorktreePruneCommand,
} from "@feature-forge/core/commands";
import { TypedEventBus } from "@feature-forge/core/event-bus";
import { createStepExecutorRegistry } from "@feature-forge/core/executors";
import { ActiveFlowRegistry } from "@feature-forge/core/flows";
import { FlowRegistrar } from "@feature-forge/core/flows";
import { connectChildClient } from "@feature-forge/core/ipc";
import { ParentSocketServer } from "@feature-forge/core/ipc";
import { SharedStreamDir } from "@feature-forge/core/progress";
import { CommandRegistry, ToolRegistry } from "@feature-forge/core/registry";
import { withForgePrefix } from "@feature-forge/core/registry";
import {
  GitWorktreeProvider,
  WorkspaceManager,
  WorkspaceProviderRegistry,
  WorktreeRegistry,
} from "@feature-forge/core/workspace";
import { registerSignalHandlers } from "@feature-forge/core/workspace";

import { AgentListCommand, FlowExitCommand, ForgeInitCommand } from "./commands";
import { activateForgeInitContext } from "./extensions/forge-init-context";
import { activateForgeSkills } from "./extensions/forge-skills";
import { registerDevTestCommands } from "./extensions/registerTestCommands";
import { activateSkillNudge } from "./extensions/skill-nudge";
import { activateSpecResolution } from "./extensions/spec-resolution";
import {
  DestroyAgentTool,
  GetAgentResultTool,
  ListAgentsTool,
  SendTaskTool,
  SetFlowParamTool,
  SetSessionNameTool,
  SkillPersistTool,
  SkillValidateTool,
  SpawnAgentTool,
} from "./tools";
import { RoutineTool } from "./tools/RoutineTool";

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
  const cwd = process.cwd();
  let config: Readonly<ForgeConfigData> | undefined;
  try {
    config = await ForgeConfigLoader.load({ cwd });
  } catch (error) {
    logger.warn("[feature-forge] Failed to load configuration", { error });
    registerDegradedMode(
      `Feature Forge could not load its configuration — ${
        error instanceof Error ? error.message : String(error)
      }. Run /forge:init to repair, then restart pi.`,
    );
    return;
  }
  const forgeDir = ForgeConfigPaths.resolveForgeDir(config, cwd);

  // ── Logging ────────────────────────────────────────────────────────
  FileLogger.initialize(config);

  // Prune stale agent-streams dirs from previous sessions now that the
  // logger is live, so post-mortem history stays within the retention window.
  SharedStreamDir.cleanup(
    config.logDir ?? DEFAULT_FORGE_CONFIG.logDir,
    config.logRetentionDays ?? DEFAULT_FORGE_CONFIG.logRetentionDays,
  );

  // Shared mutable env that PiSubprocessAgentFactory reads lazily.
  // Start the server first, then write the socket path here so spawned
  // children receive FORGE_PARENT_SOCKET in their process environment.
  const childEnv: Record<string, string> = {};

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
  for (const agentSpecDir of ForgeConfigPaths.resolveAgentSpecDirectories(config, cwd)) {
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
      cliPath: config.piCli,
    },
    config.models,
    {
      defaultTimeoutMs: config.taskTimeoutMs ?? DEFAULT_FORGE_CONFIG.taskTimeoutMs,
      forgeDir,
    },
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
  activateForgeSkills(pi, forgeDir);

  // Every session runs as a client.
  // Child sessions: FORGE_PARENT_SOCKET points to the parent's server.
  // Root parent: no env var, so connect to our own server (loopback).
  // connectChildClient also forwards agent_update push events to the user.
  const client = await connectChildClient(targetSocketPath, pi, {
    defaultTimeoutMs: config.taskTimeoutMs ?? DEFAULT_FORGE_CONFIG.taskTimeoutMs,
  });

  // Set up worktree infrastructure
  const repoRoot = process.cwd();
  const worktreeProvider = new GitWorktreeProvider(repoRoot, undefined, {
    worktreeSymlinks: config.worktreeSymlinks ?? DEFAULT_FORGE_CONFIG.worktreeSymlinks,
  });
  const worktreeRegistry = new WorktreeRegistry();
  try {
    await worktreeRegistry.load();
    // Surface crash leftovers (stale registry entries, orphaned worktrees,
    // orphaned forge/* branches) on startup; never brick the extension.
    await worktreeRegistry.reconcileAndLog(repoRoot);
  } catch (error) {
    logger.warn("[feature-forge] Failed to load or reconcile worktree registry", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Capture the pi session id (UUIDv7) as soon as it is observable so
  // registry entries created by this process are attributed to the owning
  // session. Refreshed on every session hook - /new and /resume swap the
  // session mid-process. The id can legitimately be absent before the
  // first hook fires; entries then stay unstamped.
  let sessionId: string | undefined;
  pi.on("session_start", (_event, ctx) => {
    sessionId = ctx.sessionManager.getSessionId();
  });
  pi.on("before_agent_start", (_event, ctx) => {
    sessionId = ctx.sessionManager.getSessionId();
  });
  worktreeRegistry.setSessionIdProvider(() => sessionId);

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

  // Skill self-improvement toolset: deterministic structure gate
  // (skill_validate) and scope-resolved persistence (skill_persist). Both
  // are dependency-free local tools - no IPC, no constructor deps.
  toolRegistry.registerInstance(new SkillValidateTool());
  toolRegistry.registerInstance(new SkillPersistTool());

  // ── Root-only session extensions ─────────────────────────────────
  // Child sessions (FORGE_PARENT_SOCKET set) receive the parent's context
  // via their spec and must not inject the init block or run the wrap-up
  // nudge. Registered after ActiveFlowRegistry exists so the nudge shares
  // the instance used by OrchestratorCommand/FlowExitCommand for its
  // mid-flow guard.
  if (!process.env.FORGE_PARENT_SOCKET) {
    activateForgeInitContext(pi);
    activateSkillNudge(pi, activeFlowRegistry);
  }

  const cmdRegistry = new CommandRegistry(
    supervisor,
    pi,
    specManager,
    toolRegistry,
    workspaceManager,
    worktreeRegistry,
    activeFlowRegistry,
    config,
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

  const workspaceProviderRegistry = new WorkspaceProviderRegistry().register(
    "git-worktree",
    worktreeProvider,
  );

  // ── Step executor registry ───────────────────────────────────────
  const stepExecutorRegistry = createStepExecutorRegistry(
    workspaceProviderRegistry,
    supervisor,
    specManager,
    worktreeRegistry,
    workspaceManager,
    {
      jsonRetryMaxAttempts:
        config.jsonRetryMaxAttempts ?? DEFAULT_FORGE_CONFIG.jsonRetryMaxAttempts,
    },
  );

  // ── Flow-based orchestration commands ────────────────────────────
  const flowDirs = [
    path.join(forgeDir, "flows"),
    ...ForgeConfigPaths.resolveFlowDirectories(config, cwd),
  ];
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
    models: config.models,
    // The remaining seam factory (issue section 6 D3): FlowRegistrar (core)
    // must not import cli — the concrete RoutineTool is wired here at the
    // composition root.
    createRoutineTool: (flowName, routineDef, routineExecutor, supervisor) =>
      new RoutineTool(flowName, routineDef, routineExecutor, supervisor, {
        config,
      }),
  });
  await flowRegistrar.registerAll();

  registerDevTestCommands(pi, toolRegistry, config);
};

export default featureForgeExtension;
