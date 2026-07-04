import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { EventBus, ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { InMemoryAgentSupervisor, SpecManager } from "../agents";
import { OrchestratorCommand } from "../commands";
import { logger } from "../logging";
import { CommandRegistry, ToolRegistry } from "../registry";
import { WorkspaceManager } from "../workspace";
import { createSetFlowParamTool } from "./builtins/createSetFlowParamTool";
import { RoutineRefStepExecutor } from "./executors/RoutineRefStepExecutor";
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
  constructor(
    private readonly params: {
      pi: ExtensionAPI;
      cmdRegistry: CommandRegistry;
      toolRegistry: ToolRegistry;
      supervisor: InMemoryAgentSupervisor;
      specManager: SpecManager;
      workspaceManager: WorkspaceManager;
      flowsDir: string;
      knownProviders: ReadonlySet<string>;
      stepExecutorRegistry: StepExecutorRegistry;
      eventBus: EventBus;
    },
  ) {}

  /**
   * Discover flow directories, load each flow definition, and register
   * orchestrator commands and routine tools.
   *
   * Uses a two-phase approach:
   * 1. Load all flows structurally and validate each individually.
   * 2. Run cross-flow validation and register the RoutineRefStepExecutor
   *    once all flows are known.
   * 3. Register orchestrator commands and routine tools for valid flows.
   */
  async registerAll(): Promise<void> {
    const {
      pi,
      cmdRegistry,
      toolRegistry,
      supervisor,
      specManager,
      workspaceManager,
      flowsDir,
      knownProviders,
      stepExecutorRegistry,
      eventBus,
    } = this.params;

    const flowDirectories = await this.discoverFlowDirectories(flowsDir);

    // Phase 1: Load all flows into a map.
    const loadedFlows = new Map<string, FlowDefinition>();

    for (const flowName of flowDirectories) {
      const flowDir = path.join(flowsDir, flowName);

      // Skip flows without an orchestrator markdown file.
      const orchestratorFile = path.join(flowDir, "orchestrator.md");
      try {
        await fs.access(orchestratorFile);
      } catch {
        logger.warn(`[feature-forge] Orchestrator persona file not found for flow "${flowName}"`);
        continue;
      }

      // Load orchestrator specs.
      try {
        await specManager.loadFromDirectory(flowDir);
      } catch (error) {
        logger.warn(`[feature-forge] Failed to load orchestrator specs for flow "${flowName}"`, {
          error,
        });
        continue;
      }

      // Load and validate the flow definition.
      const knownSpecs = specManager.specNames();
      const flowLoader = new FlowLoader({ flowsDir: flowDir, knownSpecs, knownProviders });
      try {
        const flow = await flowLoader.load("flow");
        loadedFlows.set(flowName, flow);
      } catch (error) {
        logger.warn(`[feature-forge] Failed to load flow "${flowName}"`, {
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    if (loadedFlows.size === 0) return;

    // Phase 2: Cross-flow validation. Fails early when flows
    // reference unknown targets or form circular dependencies.
    const crossFlowErrors = FlowLoader.validateCrossFlow(loadedFlows);
    if (crossFlowErrors.length > 0) {
      throw new Error(
        `Cross-flow validation failed with ${crossFlowErrors.length} error(s):\n` +
          crossFlowErrors.map((e) => `  - ${e}`).join("\n"),
      );
    }

    // Register RoutineRefStepExecutor now that all flows are known.
    stepExecutorRegistry.register(() => new RoutineRefStepExecutor(loadedFlows));

    // Phase 3: Register orchestrator commands and routine tools.
    for (const [flowName, flow] of loadedFlows) {
      const store = new FlowStateStore();

      // Seed flow-global session from flow-level param defaults.
      for (const param of flow.params ?? []) {
        if (param.default !== undefined) {
          store.set(param.name, param.default);
        }
      }

      // Construct the orchestrator command.
      const orchestratorCommand = new OrchestratorCommand(
        supervisor,
        pi,
        specManager,
        workspaceManager,
        flow,
      );
      try {
        cmdRegistry.registerInstance(orchestratorCommand);
      } catch (error) {
        logger.warn(
          `[feature-forge] Failed to register OrchestratorCommand for flow "${flowName}"`,
          { error },
        );
      }

      // Register routine tools for this flow.
      const routineExecutor = new RoutineExecutor(flow, stepExecutorRegistry, eventBus, store);
      for (const [routineName, routineDef] of Object.entries(flow.routines)) {
        const routineTool = new RoutineTool(flowName, routineName, routineExecutor, routineDef);
        try {
          toolRegistry.registerInstance(routineTool);
        } catch (error) {
          logger.warn(`[feature-forge] Failed to register RoutineTool "${routineTool.name}"`, {
            error,
          });
        }
      }

      // Builtin routines.
      try {
        toolRegistry.registerInstance(createSetFlowParamTool(flowName, routineExecutor));
      } catch (error) {
        logger.warn("[feature-forge] Failed to register set_flow_param", { error });
      }
    }
  }

  private async discoverFlowDirectories(flowsDir: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(flowsDir, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch {
      return [];
    }
  }
}
