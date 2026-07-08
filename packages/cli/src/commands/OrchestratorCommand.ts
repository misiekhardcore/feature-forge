import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import type { AgentSupervisor } from "../agents";
import type { InSessionAgent } from "../agents/agents/InSessionAgent";
import { SessionAgent } from "../agents/agents/SessionAgent";
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

    if (!this.spec) {
      this.spec = this.specManager.resolve({
        spec: this.flow.orchestrator.systemPrompt,
      });
    }

    if (!this.agent) {
      this.agent = await this.supervisor.mountInSession(this.spec);
    }

    this.agent.mount(this.pi, this.resolveTask(userTask));

    ctx.ui.notify(`${this.flow.name} orchestrator loaded.`, "info");
  }

  /** Whether the flow's session agent is currently mounted and active. */
  public get isFlowActive(): boolean {
    return this.agent instanceof SessionAgent && this.agent.isMounted;
  }

  /**
   * Unmount the active session agent, restore default tools, and send an
   * exit message to return the session to default operating mode.
   */
  public unmountFlow(): void {
    if (this.agent instanceof SessionAgent) {
      this.agent.unmount();
      this.pi.sendUserMessage(
        "All flow and role modes have been exited. " +
          "Return to standard default operation. " +
          "Forget all previous orchestrator, flow, skill, and role instructions. " +
          "Use only the default tools and the base system prompt. " +
          "Do not continue or reference any previous flow tasks. " +
          'Acknowledge with "Flow exited. Ready."',
      );
    }
  }

  /**
   * Resolve the orchestrator prompt template against the user's slash-command
   * args. `{{prompt}}` maps to the (fallback-guarded) user task; any other
   * `{{key}}` is resolved from `flow.orchestrator.promptParams`.
   */
  private resolveTask(userTask: string): string {
    const template = this.flow.orchestrator.prompt ?? "";
    const params: Record<string, string> = {
      ...(this.flow.orchestrator.promptParams ?? {}),
      prompt: userTask,
    };

    return template.replaceAll(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
      const value = params[key.trim()];
      return value !== undefined ? value : "";
    });
  }
}
