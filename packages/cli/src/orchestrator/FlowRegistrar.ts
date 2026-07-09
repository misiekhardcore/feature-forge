import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { InMemoryAgentSupervisor, SpecManager } from "../agents";
import { OrchestratorCommand } from "../commands";
import { logger } from "../logging";
import { CommandRegistry, ToolRegistry } from "../registry";
import { WorkspaceManager } from "../workspace";
import { createSetFlowParamTool } from "./builtins/createSetFlowParamTool";
import { FlowLoader } from "./FlowLoader";
import { FlowStateStore } from "./FlowStateStore";
import { RoutineExecutor } from "./RoutineExecutor";
import { RoutineTool } from "./RoutineTool";
import { RuntimeCapabilities } from "./RuntimeCapabilities";

/**
 * Discovers flow definitions in a directory and registers them with
 * the pi extension using two registration paths:
 *
 * 1. **Full orchestrated flows** — flows that declare an `orchestrator`
 *    config get an {@link OrchestratorCommand} registered under their
 *    slash-command name.
 * 2. **Library-only flows** — flows without an `orchestrator` config
 *    only register their routine tools. They are callable from other
 *    flows via {@link RoutineRefStepExecutor} but have no direct
 *    slash command in the TUI.
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
      runtimeCapabilities: RuntimeCapabilities;
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
      runtimeCapabilities,
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
        runtimeCapabilities,
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
      supervisor: InMemoryAgentSupervisor;
      specManager: SpecManager;
      workspaceManager: WorkspaceManager;
      knownProviders: ReadonlySet<string>;
      runtimeCapabilities: RuntimeCapabilities;
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
      runtimeCapabilities,
    } = ctx;

    // Load and validate the flow definition first, so we can decide which
    // registration path to take based on whether the flow has an orchestrator.
    const knownSpecs = specManager.specNames();
    const flowLoader = new FlowLoader({ flowsDir: flowDir, knownSpecs, knownProviders });
    let flow;
    const store = new FlowStateStore();
    try {
      flow = await flowLoader.load("flow");

      // Register the loaded flow in runtime capabilities so cross-flow
      // routine references can look it up by command name.
      runtimeCapabilities.flows.set(flow.command, flow);

      // Seed flow-global session from flow-level param defaults.
      for (const param of flow.params ?? []) {
        if (param.default !== undefined) {
          store.set(param.name, param.default);
        }
      }
    } catch (error) {
      logger.warn(`[feature-forge] Failed to load flow "${flowName}"`, { error });
      return;
    }

    // ── Registration path 1: full orchestrated flow ──
    // Only register the orchestrator command and load the orchestrator persona
    // when the flow declares an orchestrator config.
    if (flow.orchestrator) {
      // Register the orchestrator persona as a spec in the shared registry.
      // The persona stays co-located with its flow but is loaded by the same
      // `SpecLoader`. See ADR 0007.
      try {
        await specManager.loadFromDirectory(flowDir);
      } catch (error) {
        logger.warn(`[feature-forge] Failed to load orchestrator specs for flow "${flowName}"`, {
          error,
        });
        // Don't skip — still register the routine tools.
      }

      // Construct the orchestrator command and register it through the
      // CommandRegistry so it follows the same registration path as all
      // other commands.
      try {
        const orchestratorCommand = new OrchestratorCommand(
          supervisor,
          pi,
          specManager,
          workspaceManager,
          flow,
        );
        cmdRegistry.registerInstance(orchestratorCommand);
      } catch (error) {
        logger.warn(
          `[feature-forge] Failed to register OrchestratorCommand "${OrchestratorCommand.name}"`,
          { error },
        );
      }
    }

    // ── Registration path 2: routine tools (always registered) ──
    // Every flow — whether orchestrated or library-only — exposes its
    // routines as tools callable from other flows.
    const routineExecutor = new RoutineExecutor(
      flow,
      runtimeCapabilities.stepExecutorRegistry,
      runtimeCapabilities.eventBus,
      store,
    );
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
          error,
        });
      }
    }

    // Builtin routines — available in every flow, not declared in flow.json.
    try {
      toolRegistry.registerInstance(createSetFlowParamTool(flowName, routineExecutor, supervisor));
    } catch (error) {
      logger.warn("[feature-forge] Failed to register set_flow_param", { error });
    }
  }
}
