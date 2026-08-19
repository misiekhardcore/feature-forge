import * as path from "node:path";

import type { ExtensionAPI, RegisteredCommand } from "@earendil-works/pi-coding-agent";
import { logger } from "@feature-forge/core";
import { InMemoryAgentSupervisor, SpecManager } from "@feature-forge/core/src/agents";
import type { TypedEventBus } from "@feature-forge/core/src/event-bus";
import type { StepExecutorRegistry } from "@feature-forge/core/src/executors/StepExecutorRegistry";
import { RoutineExecutor } from "@feature-forge/core/src/routines/RoutineExecutor";
import type { Tool } from "@feature-forge/core/src/tools";

import type { ActiveFlowRegistry } from "./ActiveFlowRegistry";
import type { FlowDefinition, RoutineDefinition } from "./FlowInstruction";
import { discoverFlowDirectories, FlowLoader } from "./FlowLoader";
import { FlowStateStore } from "./FlowStateStore";

/**
 * A command shaped like pi's registered-command contract. cli's `Command`
 * base implements `Omit<RegisteredCommand, "sourceInfo">` exactly, so this
 * is the structural seam between core's flow engine and cli's command
 * registry (which stays in cli per the issue tree).
 */
type FlowCommand = Omit<RegisteredCommand, "sourceInfo">;

/** Structural surface of cli's `CommandRegistry` (stays in cli per the issue tree). */
export interface CommandRegistryLike {
  registerInstance(command: FlowCommand): FlowCommand;
}

/**
 * Structural surface of cli's `ToolRegistry` (stays in cli per the issue tree).
 *
 * `registerInstance` is used by {@link FlowRegistrar}; `get` is read through
 * {@link RoutineExecutor} by the cli `RoutineTool` (which hands it to the
 * agent viewer as a `ToolFormatter`).
 */
export interface ToolRegistryLike {
  registerInstance(tool: Tool): Tool;
  get(name: string): Tool | undefined;
}

/**
 * Structural surface of cli's `WorkspaceManager` (stays in cli until S4e).
 *
 * Only threaded through to the orchestrator command factory — the minimal
 * surface is the member the cli `OrchestratorCommand` actually reads when
 * snapshotting pre-existing workspaces before mounting the session agent.
 */
export interface WorkspaceManagerLike {
  list(): readonly { path: string }[];
}

/**
 * Dependency bag for the flow's orchestrator slash command.
 *
 * Core-owned collaborators use their concrete types; cli-owned
 * collaborators (`toolRegistry`, `workspaceManager`) are structural —
 * typed by the members the cli `OrchestratorCommand` actually uses. The
 * cli composition root wires this into the concrete command (the single
 * documented cast lives there).
 */
export interface OrchestratorCommandDeps {
  pi: ExtensionAPI;
  supervisor: InMemoryAgentSupervisor;
  specManager: SpecManager;
  toolRegistry: ToolRegistryLike;
  workspaceManager?: WorkspaceManagerLike;
  flow: FlowDefinition;
  store: FlowStateStore;
  activeFlow: ActiveFlowRegistry;
}

/** Factory for one flow's routine tool — provided by the cli composition root (S6 seam). */
export type CreateRoutineTool = (
  flowName: string,
  routineDef: RoutineDefinition,
  routineExecutor: RoutineExecutor,
  supervisor: InMemoryAgentSupervisor,
) => Tool;

/** Factory for one flow's orchestrator command — provided by the cli composition root. */
export type CreateOrchestratorCommand = (deps: OrchestratorCommandDeps) => FlowCommand;

/**
 * Shared context threaded through flow registration: the pi extension
 * surface plus the registries and managers each discovered flow wires into.
 *
 * Passed as a single object so fields never get destructured and rebuilt
 * at every call boundary.
 */
export interface FlowRegistrarContext {
  pi: ExtensionAPI;
  cmdRegistry: CommandRegistryLike;
  toolRegistry: ToolRegistryLike;
  supervisor: InMemoryAgentSupervisor;
  specManager: SpecManager;
  workspaceManager: OrchestratorCommandDeps["workspaceManager"];
  flowDirs: readonly string[];
  knownProviders: ReadonlySet<string>;
  stepExecutorRegistry: StepExecutorRegistry;
  eventBus: TypedEventBus;
  activeFlowRegistry: ActiveFlowRegistry;
  /** Constructs a cli `RoutineTool` for one routine of a registered flow. */
  createRoutineTool: CreateRoutineTool;
  /** Constructs the cli `OrchestratorCommand` for a registered flow. */
  createOrchestratorCommand: CreateOrchestratorCommand;
}

/**
 * Discovers flow definitions in a directory and registers their
 * orchestrator commands and routine tools with the pi extension.
 */
export class FlowRegistrar {
  /** Shared flow map keyed by flow name, populated during registerAll. */
  readonly flowMap = new Map<string, FlowDefinition>();

  constructor(private readonly context: FlowRegistrarContext) {}

  /**
   * Discover flow directories, load each flow definition, and register
   * orchestrator commands and routine tools.
   *
   * Flows are registered in a single pass. The shared {@link flowMap}
   * is populated as each flow is loaded, then threaded to the
   * {@link StepExecutorRegistry} after all flows are registered so
   * that cross-flow routine refs can be resolved.
   */
  async registerAll(): Promise<void> {
    const { flowDirs } = this.context;

    for (const flowDir of flowDirs) {
      const flowNames = await discoverFlowDirectories(flowDir);
      for (const flowName of flowNames) {
        await this.registerFlow(flowName, path.join(flowDir, flowName), this.context);
      }
    }

    // Thread the fully populated flowMap to executors that need it
    // for cross-flow routine ref resolution.
    this.context.stepExecutorRegistry.setFlowMap(this.flowMap);
  }

  private async registerFlow(
    flowName: string,
    flowDir: string,
    ctx: FlowRegistrarContext,
  ): Promise<void> {
    // Load the flow dir's orchestrator specs first — the FlowLoader validates
    // that flow.orchestrator.systemPrompt names a registered spec, so specs
    // must be loaded before the loader is constructed.
    try {
      await ctx.specManager.loadFromDirectory(flowDir);
    } catch (error) {
      logger.warn(`[feature-forge] Failed to load orchestrator specs for flow "${flowName}"`, {
        error,
      });
      return;
    }

    // Load and validate the flow definition. Specs are loaded first; a
    // failure there skips the whole flow, so reaching this point means
    // the flow is registered and the shared flowMap is populated.
    const knownSpecs = ctx.specManager.specNames();
    const flowLoader = new FlowLoader({
      flowsDir: flowDir,
      knownSpecs,
      knownProviders: ctx.knownProviders,
    });
    let flow: FlowDefinition;
    const store = new FlowStateStore();
    try {
      flow = await flowLoader.load("flow");
      this.flowMap.set(flow.name, flow);
      for (const param of flow.params ?? []) {
        if (param.default !== undefined) {
          store.set(param.name, param.default);
        }
      }
    } catch (error) {
      logger.warn(`[feature-forge] Failed to load flow "${flowName}"`, { error });
      return;
    }

    // ── Routine tools (always registered) ──
    const routineExecutor = new RoutineExecutor(
      flow,
      ctx.stepExecutorRegistry,
      ctx.eventBus,
      ctx.toolRegistry,
      store,
    );
    for (const routineDef of flow.routines) {
      const routineTool = ctx.createRoutineTool(
        flowName,
        routineDef,
        routineExecutor,
        ctx.supervisor,
      );
      try {
        ctx.toolRegistry.registerInstance(routineTool);
      } catch (error) {
        logger.warn(`[feature-forge] Failed to register RoutineTool "${routineTool.name}"`, {
          error,
        });
      }
    }

    // ── Command registration ──
    const orchestratorCommand = ctx.createOrchestratorCommand({
      supervisor: ctx.supervisor,
      pi: ctx.pi,
      specManager: ctx.specManager,
      toolRegistry: ctx.toolRegistry,
      workspaceManager: ctx.workspaceManager,
      flow,
      store,
      activeFlow: ctx.activeFlowRegistry,
    });
    try {
      ctx.cmdRegistry.registerInstance(orchestratorCommand);
    } catch (error) {
      logger.warn(`[feature-forge] Failed to register OrchestratorCommand for "${flowName}"`, {
        error,
      });
    }
  }
}
