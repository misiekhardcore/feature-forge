import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import type { AgentSupervisor } from "../agents";
import type { SpecManager } from "../agents/SpecManager";
import { FlowContext } from "../orchestrator/FlowContext";
import { FlowLoader } from "../orchestrator/FlowLoader";
import type { WorkspaceManager } from "../workspace";
import { Command } from "./Command";

/**
 * Generic flow orchestrator command.
 *
 * Loads a flow package's orchestrator prompt into the main session,
 * resolves {{task}} (and other context placeholders), and optionally
 * sets the active tool set from the flow definition.
 *
 * Usage: /implement <task description>
 */
export class OrchestratorCommand extends Command {
  readonly name: string;
  readonly description: string;

  private readonly flowName: string;
  private readonly flowsDir: string;

  constructor(
    supervisor: AgentSupervisor,
    pi: ExtensionAPI,
    specManager: SpecManager,
    flowName: string,
    flowsDir: string,
    workspaceManager?: WorkspaceManager,
  ) {
    super(supervisor, pi, specManager, workspaceManager);
    this.flowName = flowName;
    this.name = flowName;
    this.flowsDir = flowsDir;
    this.description = `Run the ${flowName} flow. Usage: /${flowName} <task>`;
  }

  handler = async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
    const task = args.trim();
    if (!task) {
      ctx.ui.notify(`Usage: /${this.flowName} <task description>`, "error");
      return;
    }

    const loader = new FlowLoader(this.flowsDir);
    let flow;
    try {
      flow = await loader.load(this.flowName);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Failed to load flow "${this.flowName}": ${message}`, "error");
      return;
    }

    const promptFile = flow.orchestrator.prompt;
    const mdPath = path.join(this.flowsDir, this.flowName, promptFile);

    let promptText: string;
    try {
      promptText = await fs.readFile(mdPath, "utf-8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Failed to read orchestrator prompt: ${message}`, "error");
      return;
    }

    const context = new FlowContext(new Map(), task, "");
    const resolvedPrompt = context.resolve(promptText);

    await this.pi.sendUserMessage(resolvedPrompt);

    if (flow.orchestrator.activeTools && flow.orchestrator.activeTools.length > 0) {
      ctx.ui.notify(
        `Active tools for ${this.flowName}: ${flow.orchestrator.activeTools.join(", ")}`,
        "info",
      );
    }
  };
}
