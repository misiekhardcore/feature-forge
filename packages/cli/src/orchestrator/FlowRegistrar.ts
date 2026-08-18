import * as path from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { logger } from "@feature-forge/core";
import { InMemoryAgentSupervisor, SpecManager } from "@feature-forge/core/src/agents";

import { OrchestratorCommand } from "../commands";
import { CommandRegistry, ToolRegistry } from "../registry";
import { WorkspaceManager } from "../workspace";
import type { ActiveFlowRegistry } from "./ActiveFlowRegistry";
import type { TypedEventBus } from "./eventBus";
import type { FlowDefinition } from "./FlowInstruction";
import { discoverFlowDirectories, FlowLoader } from "./FlowLoader";
import { FlowStateStore } from "./FlowStateStore";
import { RoutineExecutor } from "./RoutineExecutor";
import { RoutineTool } from "./RoutineTool";
import { StepExecutorRegistry } from "./StepExecutorRegistry";

/**
 * Shared context threaded through flow registration: the pi extension
 * surface plus the registries and managers each discovered flow wires into.
 *
 * Passed as a single object so fields never get destructured and rebuilt
 * at every call boundary.
 */
interface FlowRegistrarContext {
  pi: ExtensionAPI;
  cmdRegistry: CommandRegistry;
  toolRegistry: ToolRegistry;
  supervisor: InMemoryAgentSupervisor;
  specManager: SpecManager;
  workspaceManager: WorkspaceManager;
  flowDirs: readonly string[];
  knownProviders: ReadonlySet<string>;
  stepExecutorRegistry: StepExecutorRegistry;
  eventBus: TypedEventBus;
  activeFlowRegistry: ActiveFlowRegistry;
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
      const routineTool = new RoutineTool(flowName, routineDef, routineExecutor, ctx.supervisor);
      try {
        ctx.toolRegistry.registerInstance(routineTool);
      } catch (error) {
        logger.warn(`[feature-forge] Failed to register RoutineTool "${routineTool.name}"`, {
          error,
        });
      }
    }

    // ── Command registration ──
    const orchestratorCommand = new OrchestratorCommand({
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
