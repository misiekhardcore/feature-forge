import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { logger } from "@feature-forge/shared";

import { InMemoryAgentSupervisor, SpecManager } from "../agents";
import { OrchestratorCommand } from "../commands";
import { CommandRegistry, ToolRegistry } from "../registry";
import { WorkspaceManager } from "../workspace";
import type { TypedEventBus } from "./eventBus";
import type { FlowDefinition } from "./FlowInstruction";
import { FlowLoader } from "./FlowLoader";
import { FlowStateStore } from "./FlowStateStore";
import { RoutineExecutor } from "./RoutineExecutor";
import { RoutineTool } from "./RoutineTool";
import { StepExecutorRegistry } from "./StepExecutorRegistry";

/**
 * Discovers flow definitions in a directory and registers their
 * orchestrator commands and routine tools with the pi extension.
 */
export class FlowRegistrar {
  /** Shared flow map keyed by flow name, populated during registerAll. */
  readonly flowMap = new Map<string, FlowDefinition>();

  constructor(
    private readonly params: {
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
    },
  ) {}

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
    const {
      pi,
      cmdRegistry,
      toolRegistry,
      supervisor,
      specManager,
      workspaceManager,
      flowDirs,
      knownProviders,
      stepExecutorRegistry,
      eventBus,
    } = this.params;

    for (const flowDir of flowDirs) {
      const flowNames = await this.discoverFlowDirectories(flowDir);
      for (const flowName of flowNames) {
        await this.registerFlow(flowName, path.join(flowDir, flowName), {
          pi,
          cmdRegistry,
          toolRegistry,
          supervisor,
          specManager,
          workspaceManager,
          knownProviders,
          stepExecutorRegistry,
          eventBus,
        });
      }
    }

    // Thread the fully populated flowMap to executors that need it
    // for cross-flow routine ref resolution.
    stepExecutorRegistry.setFlowMap(this.flowMap);
  }

  private async discoverFlowDirectories(flowsDir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(flowsDir, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  private async registerFlow(
    flowName: string,
    flowDir: string,
    ctx: {
      pi: ExtensionAPI;
      cmdRegistry: CommandRegistry;
      toolRegistry: ToolRegistry;
      supervisor: InMemoryAgentSupervisor;
      specManager: SpecManager;
      workspaceManager: WorkspaceManager;
      knownProviders: ReadonlySet<string>;
      stepExecutorRegistry: StepExecutorRegistry;
      eventBus: TypedEventBus;
    },
  ): Promise<void> {
    const {
      pi,
      cmdRegistry,
      toolRegistry,
      supervisor,
      specManager,
      workspaceManager,
      knownProviders,
      stepExecutorRegistry,
      eventBus,
    } = ctx;

    // Load the flow dir's orchestrator specs first — the FlowLoader validates
    // that flow.orchestrator.systemPrompt names a registered spec, so specs
    // must be loaded before the loader is constructed.
    try {
      await specManager.loadFromDirectory(flowDir);
    } catch (error) {
      logger.warn(`[feature-forge] Failed to load orchestrator specs for flow "${flowName}"`, {
        error,
      });
      return;
    }

    // Load and validate the flow definition. Specs are loaded first; a
    // failure there skips the whole flow, so reaching this point means
    // the flow is registered and the shared flowMap is populated.
    const knownSpecs = specManager.specNames();
    const flowLoader = new FlowLoader({ flowsDir: flowDir, knownSpecs, knownProviders });
    let flow;
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
      stepExecutorRegistry,
      eventBus,
      toolRegistry,
      store,
    );
    for (const routineDef of flow.routines) {
      const routineTool = new RoutineTool(flowName, routineDef, routineExecutor, supervisor);
      try {
        toolRegistry.registerInstance(routineTool);
      } catch (error) {
        logger.warn(`[feature-forge] Failed to register RoutineTool "${routineTool.name}"`, {
          error,
        });
      }
    }

    // ── Command registration ──
    const orchestratorCommand = new OrchestratorCommand({
      supervisor,
      pi,
      specManager,
      toolRegistry,
      workspaceManager,
      flow,
    });
    try {
      cmdRegistry.registerInstance(orchestratorCommand);
    } catch (error) {
      logger.warn(`[feature-forge] Failed to register OrchestratorCommand for "${flowName}"`, {
        error,
      });
    }
  }
}
