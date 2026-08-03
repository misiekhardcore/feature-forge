import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { ForgeConfig, resolveModel } from "@feature-forge/shared";

import type { AgentSupervisor } from "../agents";
import { SessionAgent } from "../agents/agents/SessionAgent";
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
 * 3. registers an in-session {@link SessionAgent} via
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
  private agent: SessionAgent | undefined;

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

    if (!this.specManager) {
      ctx.ui.notify("SpecManager not available — orchestrator spec cannot be resolved.", "error");
      return;
    }

    if (!this.spec) {
      this.spec = this.specManager.resolve({
        spec: this.flow.orchestrator.systemPrompt,
      });
    }

    // Apply orchestrator model and thinking level to the main pi session.
    // The spec's model field (from frontmatter) is resolved against forge config
    // presets; the resolved model is looked up in pi's runtime registry.
    if (this.spec.model || this.spec.thinkingLevel) {
      try {
        const forgeConfig = ForgeConfig.getInstance();
        const resolvedModel = resolveModel(this.spec.model, forgeConfig.getConfig().models);

        // Apply thinkingLevel: explicit spec value wins over preset value
        if (this.spec.thinkingLevel) {
          this.pi.setThinkingLevel(this.spec.thinkingLevel);
        } else if (resolvedModel?.thinkingLevel) {
          this.pi.setThinkingLevel(resolvedModel.thinkingLevel);
        }

        // Apply model: find matching model in pi's runtime registry
        if (resolvedModel) {
          const availableModels = ctx.modelRegistry.getAvailable();
          const match = availableModels.find((m) => {
            const idMatch = m.id === resolvedModel.model;
            const providerMatch = !resolvedModel.provider || m.provider === resolvedModel.provider;
            return idMatch && providerMatch;
          });
          if (match) {
            await this.pi.setModel(match);
          }
        }
      } catch {
        // ForgeConfig might not be initialized (e.g. in tests without config).
        // Swallow — model/thinkingLevel resolution is best-effort.
      }
    }

    if (!this.agent) {
      this.agent = await this.supervisor.mountInSession(this.spec);
    }

    if (this.workspaceManager) {
      this.agent.snapshotWorkspaces(this.workspaceManager);
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
