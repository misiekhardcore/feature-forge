import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { AgentSupervisor, SpecManager } from "../agents";
import { OrchestratorCommand } from "../commands";
import { logger } from "../logging";
import { CommandRegistry, ToolRegistry } from "../registry";
import { WorkspaceManager } from "../workspace";
import { createSetFlowParamTool } from "./builtins/createSetFlowParamTool";
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
  constructor(
    private readonly params: {
      pi: ExtensionAPI;
      cmdRegistry: CommandRegistry;
      toolRegistry: ToolRegistry;
      supervisor: AgentSupervisor;
      specManager: SpecManager;
      workspaceManager: WorkspaceManager;
      flowsDir: string;
      knownProviders: ReadonlySet<string>;
      stepExecutorRegistry: StepExecutorRegistry;
      eventBus: TypedEventBus;
      /**
       * Optional map to populate with loaded flow definitions, keyed by command.
       * Allows lookup of flow definitions without requiring an orchestrator.
       */
      flowMap?: Map<string, FlowDefinition>;
    },
  ) {}

  /**
   * Discover flow directories, load each flow definition, and register
   * orchestrator commands and routine tools.
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

    for (const flowName of flowDirectories) {
      const flowDir = path.join(flowsDir, flowName);
      await this.registerFlow(flowName, flowDir, {
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
      supervisor: AgentSupervisor;
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

    // 1. Load flow.json first — always, even for library-only flows (no orchestrator).
    const knownSpecs = specManager.specNames();
    const flowLoader = new FlowLoader({ flowsDir: flowDir, knownSpecs, knownProviders });
    let flow;
    const store = new FlowStateStore();
    try {
      flow = await flowLoader.load("flow");

      // Seed flow-global session from flow-level param defaults.
      for (const param of flow.params ?? []) {
        if (param.default !== undefined) {
          store.set(param.name, param.default);
        }
      }

      // 2. Populate flowMap if provided.
      this.params.flowMap?.set(flow.command, flow);
    } catch (error) {
      logger.warn(`[feature-forge] Failed to load flow "${flowName}"`, {
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return;
    }

    // 3. Check whether an orchestrator markdown file exists.
    const orchestratorFile = path.join(flowDir, "orchestrator.md");
    let hasOrchestrator = false;
    try {
      await fs.access(orchestratorFile);
      hasOrchestrator = true;
    } catch {
      // Library-only flow — no orchestrator, but tools are still registered below.
    }

    // 4. If orchestrator is present and the flow defines one, register command.
    let specsLoaded = false;
    if (hasOrchestrator && flow.orchestrator) {
      try {
        await specManager.loadFromDirectory(flowDir);
        specsLoaded = true;
      } catch (error) {
        logger.warn(`[feature-forge] Failed to load orchestrator specs for flow "${flowName}"`, {
          error: error instanceof Error ? error : new Error(String(error)),
        });
        // Do not return — tools are still registered below even without an orchestrator command.
      }

      if (specsLoaded) {
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
            `[feature-forge] Failed to register OrchestratorCommand "${OrchestratorCommand.name}"`,
            {
              error: error instanceof Error ? error : new Error(String(error)),
            },
          );
        }
      }
    }

    // Register routine tools for this flow.
    const routineExecutor = new RoutineExecutor(flow, stepExecutorRegistry, eventBus, store);
    for (const [routineName, routineDef] of Object.entries(flow.routines)) {
      const routineTool = new RoutineTool(
        flowName,
        routineName,
        routineExecutor,
        routineDef,
        supervisor,
      );
      try {
        toolRegistry.registerInstance(routineTool);
      } catch (error) {
        logger.warn(`[feature-forge] Failed to register RoutineTool "${routineTool.name}"`, {
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    // Builtin routines — available in every flow, not declared in flow.json.
    try {
      toolRegistry.registerInstance(createSetFlowParamTool(flowName, routineExecutor, supervisor));
    } catch (error) {
      logger.warn("[feature-forge] Failed to register set_flow_param", {
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }
}
