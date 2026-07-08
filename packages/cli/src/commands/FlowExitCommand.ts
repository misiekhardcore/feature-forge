import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import type { AgentSupervisor } from "../agents";
import type { SpecManager } from "../agents/SpecManager";
import type { CommandRegistry } from "../registry/CommandRegistry";
import type { WorkspaceManager } from "../workspace";
import { Command } from "./Command";

/**
 * Exits the currently active flow, restoring the original system prompt and
 * default tools.
 *
 * Finds the active {@link OrchestratorCommand} via the
 * {@link CommandRegistry}, calls {@link OrchestratorCommand.unmountFlow},
 * and notifies the user. If no flow is active, this is a no-op with a
 * notification.
 */
export class FlowExitCommand extends Command {
  readonly name = "flow:exit";
  readonly description = "exit the current flow and restore default mode";

  private readonly commandRegistry: CommandRegistry;

  constructor(
    supervisor: AgentSupervisor,
    pi: ExtensionAPI,
    specManager: SpecManager,
    workspaceManager: WorkspaceManager | undefined,
    commandRegistry: CommandRegistry,
  ) {
    super(supervisor, pi, specManager, workspaceManager);
    this.commandRegistry = commandRegistry;
  }

  async handler(_args: string, ctx: ExtensionCommandContext): Promise<void> {
    const orchestrator = this.commandRegistry.findActiveOrchestrator();

    if (!orchestrator) {
      ctx.ui.notify("No active flow to exit.", "info");
      return;
    }

    orchestrator.unmountFlow();
    ctx.ui.notify("Flow exited. Default system prompt and tools restored.", "info");
  }
}
