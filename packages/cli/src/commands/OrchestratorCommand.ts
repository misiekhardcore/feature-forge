import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import type { AgentSupervisor } from "../agents";
import type { InSessionAgent } from "../agents/agents/InSessionAgent";
import type { AgentSpecification } from "../agents/specifications";
import type { SpecManager } from "../agents/SpecManager";
import type { FlowDefinition } from "../orchestrator/FlowInstruction";
import { ToolRegistry } from "../registry/ToolRegistry";
import type { WorkspaceManager } from "../workspace";
import { Command } from "./Command";

/**
 * Generic command that loads a flow's orchestrator persona into the main pi
 * session.
 *
 * Each loaded flow gets one `OrchestratorCommand` registered under the flow's
 * slash-command name (e.g. `/implement`). The command:
 * The {@code systemPrompt} field in the orchestrator config is **not** raw
 * prompt text — it is a spec identifier (e.g. {@code "implement-orchestrator"})
 * resolved through {@link SpecManager}. The actual markdown content lives in
 * the flow's {@code orchestrator.md} file, whose frontmatter {@code id} matches
 * the {@code systemPrompt} value. See ADR 0007.
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
    toolRegistry: ToolRegistry,
    workspaceManager: WorkspaceManager | undefined,
    flow: FlowDefinition,
  ) {
    super(supervisor, pi, specManager, toolRegistry, workspaceManager);
    this.name = flow.command.replace(/^\//, "");
    this.flow = flow;
    this.description = `Run the ${flow.name} orchestrator workflow`;
  }

  async handler(args: string, ctx: ExtensionCommandContext): Promise<void> {
    const userTask = args.trim() || "(no task provided)";

    if (!this.flow.orchestrator) {
      ctx.ui.notify(
        `Flow "${this.flow.name}" has no orchestrator config — use a headless command instead.`,
        "error",
      );
      return;
    }

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

  /**
   * Resolve the orchestrator prompt template against the user's args.
   * `{{prompt}}` → user task; other `{{key}}` → `orchestrator.promptParams`.
   */
  private resolveTask(userTask: string): string {
    const config = this.flow.orchestrator;
    const template = config?.prompt ?? "";
    const params: Record<string, string> = {
      ...(config?.promptParams ?? {}),
      prompt: userTask,
    };

    return template.replaceAll(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
      const value = params[key.trim()];
      return value !== undefined ? value : "";
    });
  }
}
