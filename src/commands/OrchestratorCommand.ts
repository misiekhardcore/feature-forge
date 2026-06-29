import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import type { AgentSupervisor } from "../agents";
import { OrchestratorAgent } from "../agents/orchestrator/OrchestratorAgent";
import type { SpecManager } from "../agents/SpecManager";
import { FlowContext } from "../orchestrator/FlowContext";
import type { FlowDefinition } from "../orchestrator/FlowInstruction";
import type { WorkspaceManager } from "../workspace";
import { Command } from "./Command";

/**
 * Generic command that loads a flow's orchestrator persona into the main pi session.
 *
 * Each loaded flow gets one OrchestratorCommand registered under the flow's
 * slash-command name (e.g. `/implement`). The command delegates to an
 * {@link OrchestratorAgent} which reads the orchestrator markdown file,
 * resolves the task template through a fresh {@link FlowContext}, sends the
 * persona + task as a user message, and sets active tools from frontmatter.
 */
export class OrchestratorCommand extends Command {
  readonly name: string;
  readonly description: string;
  private readonly flow: FlowDefinition;
  private readonly flowDir: string;
  private agent: OrchestratorAgent | undefined;

  constructor(
    supervisor: AgentSupervisor,
    pi: ExtensionAPI,
    specManager: SpecManager,
    workspaceManager: WorkspaceManager | undefined,
    flow: FlowDefinition,
    flowDir: string,
  ) {
    super(supervisor, pi, specManager, workspaceManager);
    this.name = flow.command.replace(/^\//, "");
    this.flow = flow;
    this.flowDir = flowDir;
    this.description = `Run the ${flow.name} orchestrator workflow`;
  }

  async handler(args: string, ctx: ExtensionCommandContext): Promise<void> {
    const task = args.trim() || "(no task provided)";
    const flowCtx = new FlowContext(new Map(), task);

    if (!this.agent) {
      this.agent = await OrchestratorAgent.create(this.flow, this.flowDir);
    }

    this.agent.mount(this.pi, flowCtx);

    ctx.ui.notify(`${this.flow.name} orchestrator loaded.`, "info");
  }
}
