import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { InMemoryAgentSupervisor, SpecManager } from "../agents";
import { OrchestratorCommand } from "../commands";
import { logger } from "../logging";
import { CommandRegistry, ToolRegistry } from "../registry";
import { WorkspaceManager } from "../workspace";
import { FlowLoader } from "./FlowLoader";
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
      knownSpecs: ReadonlySet<string>;
      knownProviders: ReadonlySet<string>;
      stepExecutorRegistry: StepExecutorRegistry;
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
      knownSpecs,
      knownProviders,
      stepExecutorRegistry,
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
        knownSpecs,
        knownProviders,
        stepExecutorRegistry,
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
      knownSpecs: ReadonlySet<string>;
      knownProviders: ReadonlySet<string>;
      stepExecutorRegistry: StepExecutorRegistry;
    },
  ): Promise<void> {
    const {
      pi,
      cmdRegistry,
      toolRegistry,
      supervisor,
      specManager,
      workspaceManager,
      knownSpecs,
      knownProviders,
      stepExecutorRegistry,
    } = ctx;

    // Skip flows without an orchestrator markdown file.
    const orchestratorFile = path.join(flowDir, "orchestrator.md");
    try {
      await fs.access(orchestratorFile);
    } catch {
      return;
    }

    // Load and validate the flow definition.
    const flowLoader = new FlowLoader(flowDir, knownSpecs, knownProviders);
    let flow;
    try {
      flow = await flowLoader.load("flow");
    } catch (error) {
      logger.warn(`[feature-forge] Failed to load flow "${flowName}"`, { error });
      return;
    }

    // Register the orchestrator persona as a spec in the shared registry, so
    // `OrchestratorCommand` resolves it by name (symmetric with how flow agent
    // steps reference sub-agent specs like "build"/"review"). The persona stays
    // co-located with its flow but is loaded by the same `SpecLoader`. See ADR 0007.
    try {
      await specManager.loadSpecFile(orchestratorFile);
    } catch (error) {
      logger.warn(`[feature-forge] Failed to load orchestrator persona for "${flowName}"`, {
        error,
      });
      return;
    }

    // Construct the orchestrator command with pi (needed for the base Command
    // class and agent mounting), then register it through the CommandRegistry
    // so it follows the same registration path as all other commands.
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
          error,
        },
      );
    }

    // Register routine tools for this flow.
    const routineExecutor = new RoutineExecutor(flow, stepExecutorRegistry);
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
  }
}
