import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import type { AgentSupervisor } from "../agents";
import type { SpecManager } from "../agents/SpecManager";
import { FlowContext } from "../orchestrator/FlowContext";
import type { FlowDefinition } from "../orchestrator/FlowInstruction";
import type { WorkspaceManager } from "../workspace";
import { Command } from "./Command";

/**
 * Generic command that loads a flow's orchestrator prompt into the main pi session.
 *
 * Each loaded flow gets one OrchestratorCommand registered under the flow's
 * slash-command name (e.g. `/implement`). The command resolves the orchestrator
 * prompt template through a fresh {@link FlowContext}, sends it as a user message
 * to trigger a turn, and optionally sets the flow's declared active tools.
 */
export class OrchestratorCommand extends Command {
  readonly name: string;
  readonly description: string;
  private readonly flow: FlowDefinition;
  private readonly promptContent: string;

  constructor(
    supervisor: AgentSupervisor,
    pi: ExtensionAPI,
    specManager: SpecManager,
    workspaceManager: WorkspaceManager | undefined,
    flow: FlowDefinition,
    promptContent: string,
  ) {
    super(supervisor, pi, specManager, workspaceManager);
    this.name = flow.command.replace(/^\//, "");
    this.flow = flow;
    this.promptContent = promptContent;
    this.description = `Run the ${flow.name} orchestrator workflow`;
  }

  async handler(args: string, ctx: ExtensionCommandContext): Promise<void> {
    const task = args.trim() || "(no task provided)";
    const flowCtx = new FlowContext(new Map(), task);
    const resolved = flowCtx.resolve(this.promptContent);

    // Send the orchestrator prompt to the session
    this.pi.sendUserMessage(resolved);

    // Apply active tools if declared
    if (this.flow.orchestrator.activeTools) {
      this.pi.setActiveTools(this.flow.orchestrator.activeTools);
    }

    ctx.ui.notify(`${this.flow.name} orchestrator loaded.`, "info");
  }
}
