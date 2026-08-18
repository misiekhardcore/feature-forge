import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { ForgeConfig, resolveModel } from "@feature-forge/core";
import type { AgentSupervisor } from "@feature-forge/core/src/agents";
import { SessionAgent } from "@feature-forge/core/src/agents/SessionAgent";
import type { AgentSpecification } from "@feature-forge/core/src/agents/specifications";
import type { SpecManager } from "@feature-forge/core/src/agents/SpecManager";

import type { ActiveFlowRegistry } from "../orchestrator/ActiveFlowRegistry";
import type { FlowDefinition } from "../orchestrator/FlowInstruction";
import type { FlowStateStore } from "../orchestrator/FlowStateStore";
import { ToolRegistry } from "../registry/ToolRegistry";
import type { WorkspaceManager } from "../workspace";
import { Command, type CommandDeps } from "./Command";

/**
 * Generic command that loads a flow's orchestrator persona into the main pi
 * session.
 *
 * Each loaded flow gets one `OrchestratorCommand` registered under the flow's
 * slash-command name (e.g. `/implement`). The command:
 * 1. resolves the orchestrator spec identifier (`systemPrompt`) through
 *    {@link SpecManager} - the field is **not** raw prompt text (e.g.
 *    {@code "implement-orchestrator"}). The actual markdown content lives in
 *    the flow's {@code orchestrator.md} file, whose frontmatter {@code id}
 *    matches the {@code systemPrompt} value. See ADR 0007.
 * 2. resolves `flow.orchestrator.prompt` against the user's slash-command args
 *    (trivial `{{prompt}}` substitution, plus `promptParams`) into a final
 *    `task` string;
 * 3. registers an in-session {@link SessionAgent} via
 *    `supervisor.mountInSession(spec)`; then
 * 4. `agent.mount(pi, task)` drives the live session.
 *
 * The routine engine's `FlowContext` does not appear here - the prompt template
 * is resolved inline so only a plain `task` string reaches the agent (ADR 0007).
 */
/**
 * Dependency bag for {@link OrchestratorCommand}. Extends {@link CommandDeps}
 * with the dependencies every flow command needs plus the flow itself.
 */
export interface OrchestratorCommandDeps extends CommandDeps {
  supervisor: AgentSupervisor;
  specManager: SpecManager;
  toolRegistry: ToolRegistry;
  workspaceManager?: WorkspaceManager;
  flow: FlowDefinition;
  store: FlowStateStore;
  activeFlow: ActiveFlowRegistry;
}

export class OrchestratorCommand extends Command {
  readonly name: string;
  readonly description: string;
  private readonly flow: FlowDefinition;
  // The constructor requires a supervisor, so it is always present here
  // even though the base Command class types it as optional.
  declare protected readonly supervisor: AgentSupervisor;
  // The constructor requires a SpecManager, so it is always present here
  // even though the base Command class types it as optional.
  declare protected readonly specManager: SpecManager;
  // The constructor requires an ActiveFlowRegistry, so it is always present
  // here even though the base Command class types it as optional.
  declare protected readonly activeFlow: ActiveFlowRegistry;
  private readonly store: FlowStateStore;
  // Cached after first resolution. Spec/agent changes require extension reload.
  private spec: AgentSpecification | undefined;
  private agent: SessionAgent | undefined;

  constructor(deps: OrchestratorCommandDeps) {
    super(deps);
    this.name = deps.flow.command.replace(/^\//, "");
    this.flow = deps.flow;
    this.description = `Run the ${deps.flow.name} orchestrator workflow`;
    this.store = deps.store;
  }

  async handler(args: string, ctx: ExtensionCommandContext): Promise<void> {
    const userTask = args.trim() || "(no task provided)";

    if (!this.spec) {
      try {
        this.spec = this.specManager.resolve({
          spec: this.flow.orchestrator.systemPrompt,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(
          `Cannot start ${this.flow.command}: orchestrator spec "${this.flow.orchestrator.systemPrompt}" could not be resolved (${message}). Run /forge:init and restart pi.`,
          "error",
        );
        return;
      }
    }

    // Verify every tool the spec declares is registered in pi before mounting.
    const registeredTools = new Set(this.pi.getAllTools().map((t) => t.name));
    const missingTools = this.spec.tools.filter((tool) => !registeredTools.has(tool));
    if (missingTools.length > 0) {
      ctx.ui.notify(
        `Cannot start ${this.flow.command}: tool(s) not registered: ${missingTools.join(", ")}`,
        "error",
      );
      return;
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

    // Recreate the cached agent when it is no longer usable: FlowExitCommand
    // destroys mounted agents via supervisor.destroyAgent(), which unmounts
    // them AND removes them from the supervisor map. Reusing such an agent
    // would re-mount a destroyed instance and register yet another
    // before_agent_start handler pi never removes (no pi.off()) — the
    // orchestrator persona would then leak into the session permanently.
    if (!this.agent?.isMounted || !this.supervisor.getAgent(this.agent.id)) {
      this.agent = await this.supervisor.mountInSession(this.spec);
    }

    if (this.workspaceManager) {
      this.agent.snapshotWorkspaces(this.workspaceManager);
    }

    this.agent.mount(this.pi, this.resolveTask(userTask));

    // Register the flow as active only after a successful mount — a failed
    // mount must not leave a stale pointer for set_flow_param. Spec/missing-
    // tool failures above return before this line, so they never register
    // an active flow either.
    this.activeFlow.setCurrent(this.flow.name, this.store);

    ctx.ui.notify(`${this.flow.name} orchestrator loaded.`, "info");
  }

  /**
   * Resolve the orchestrator prompt template against the user's args.
   * `{{prompt}}` → user task; other `{{key}}` → `orchestrator.promptParams`.
   */
  private resolveTask(userTask: string): string {
    const config = this.flow.orchestrator;
    const template = config.prompt ?? "";
    const params: Record<string, string> = {
      ...(config.promptParams ?? {}),
      prompt: userTask,
    };

    return template.replaceAll(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
      const value = params[key.trim()];
      return value !== undefined ? value : "";
    });
  }
}
