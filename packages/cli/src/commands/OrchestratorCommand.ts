import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import type { AgentSupervisor } from "../agents";
import type { InSessionAgent } from "../agents/agents/InSessionAgent";
import type { AgentSpecification } from "../agents/specifications";
import type { SpecManager } from "../agents/SpecManager";
import type { FlowDefinition } from "../orchestrator/FlowInstruction";
import type { WorkspaceManager } from "../workspace";
import { Command } from "./Command";

/**
 * Generic command that loads a flow's orchestrator persona into the main pi
 * session.
 *
 * Each loaded flow gets one `OrchestratorCommand` registered under the flow's
 * slash-command name (e.g. `/implement`). The command:
 * 1. resolves the orchestrator spec by name (`flow.orchestrator.systemPrompt`)
 *    via {@link SpecManager} — the same path sub-agent specs use. The persona
 *    markdown is bundled with its flow but loaded once at startup by the same
 *    `SpecLoader` and filed in the shared registry; see ADR 0007.
 * 2. resolves `flow.orchestrator.prompt` against the user's slash-command args
 *    (trivial `{{prompt}}` substitution, plus `promptParams`) into a final
 *    `task` string;
 * 3. registers an in-session {@link InSessionAgent} via
 *    `supervisor.mountInSession(spec)`; then
 * 4. `agent.mount(pi, task)` drives the live session.
 *
 * The routine engine's `FlowContext` does not appear here — the prompt template
 * is resolved inline so only a plain `task` string reaches the agent (ADR 0007).
 */
export class OrchestratorCommand extends Command {
  readonly name: string;
  readonly description: string;
  private readonly flow: FlowDefinition;
  // Cached after first resolution. Spec/agent changes require extension reload.
  private spec: AgentSpecification | undefined;
  private agent: InSessionAgent | undefined;

  constructor(
    supervisor: AgentSupervisor,
    pi: ExtensionAPI,
    specManager: SpecManager,
    workspaceManager: WorkspaceManager | undefined,
    flow: FlowDefinition,
  ) {
    super(supervisor, pi, specManager, workspaceManager);
    this.name = flow.command.replace(/^\//, "");
    this.flow = flow;
    this.description = `Run the ${flow.name} orchestrator workflow`;
  }

  async handler(args: string, ctx: ExtensionCommandContext): Promise<void> {
    const userTask = args.trim() || "(no task provided)";

    const orchestrator = this.flow.orchestrator;
    if (!orchestrator) {
      ctx.ui.notify(`${this.flow.name} has no orchestrator configured.`, "error");
      return;
    }

    if (!this.spec) {
      this.spec = this.specManager.resolve({
        spec: orchestrator.systemPrompt,
      });
    }

    if (!this.agent) {
      this.agent = await this.supervisor.mountInSession(this.spec);
    }

    this.agent.mount(this.pi, this.resolveTask(userTask, orchestrator));

    ctx.ui.notify(`${this.flow.name} orchestrator loaded.`, "info");
  }

  /**
   * Resolve the orchestrator prompt template against the user's slash-command
   * args. `{{prompt}}` maps to the (fallback-guarded) user task; any other
   * `{{key}}` is resolved from `flow.orchestrator.promptParams`.
   */
  private resolveTask(
    userTask: string,
    orchestrator: NonNullable<FlowDefinition["orchestrator"]>,
  ): string {
    const template = orchestrator.prompt ?? "";
    const params: Record<string, string> = {
      ...(orchestrator.promptParams ?? {}),
      prompt: userTask,
    };

    return template.replaceAll(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
      const value = params[key.trim()];
      return value !== undefined ? value : "";
    });
  }
}
