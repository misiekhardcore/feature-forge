import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { logger } from "@feature-forge/shared";

import { SessionAgent } from "../agents/agents/SessionAgent";
import { Command } from "./Command";

/**
 * Exits the currently active flow, restoring the original system prompt and
 * default tools.
 *
 * Finds all active {@link SessionAgent} instances via the supervisor,
 * destroys each one through {@link AgentSupervisor.destroyAgent}, and sends
 * an exit instruction to the LLM.
 * If no session agent is mounted, this is a no-op with a notification.
 * If destroying some agents fails, an error notification with the failure
 * count is shown and the LLM exit instruction is skipped.
 */
export class FlowExitCommand extends Command {
  readonly name = "flow:exit";
  readonly description = "exit the current flow and restore default mode";

  async handler(_args: string, ctx: ExtensionCommandContext): Promise<void> {
    const agents = this.supervisor.getAllAgents();
    const mountedAgents = agents.filter(
      (agent): agent is SessionAgent => agent instanceof SessionAgent && agent.isMounted,
    );

    if (mountedAgents.length === 0) {
      ctx.ui.notify("Flow exited. No active flow to exit.", "info");
      // No agents to destroy and no workspaces were created — nothing to clean up.
    } else {
      const errors: Error[] = [];
      for (const agent of mountedAgents) {
        try {
          await this.supervisor.destroyAgent(agent.id);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          errors.push(err);
          logger.error(`Failed to destroy agent "${agent.id}" during flow exit`, { error: err });
        }
      }

      if (errors.length > 0) {
        // Per-agent destroy failed — surface the error count and skip the LLM
        // exit message so remaining flow context is not dismissed.
        ctx.ui.notify(`Flow exited with ${errors.length} error(s).`, "error");
      } else {
        // Tell the LLM the flow is over so it stops following flow instructions
        // still present in conversation history.
        this.pi.sendUserMessage(
          "All flow and role modes have been exited. " +
            "Return to standard default operation. " +
            "Forget all previous orchestrator, flow, skill, and role instructions. " +
            "Use only the default tools and the base system prompt. " +
            "Do not continue or reference any previous flow tasks. " +
            'Acknowledge with "Flow exited. Ready."',
        );

        ctx.ui.notify("Flow exited. Default system prompt and tools restored.", "info");
      }
    }

    // Clean up only workspaces created after each agent's snapshot.
    if (this.workspaceManager) {
      for (const agent of mountedAgents) {
        const paths = agent.getNewWorkspacePaths(this.workspaceManager);
        for (const path of paths) {
          try {
            await this.workspaceManager.destroy(path);
          } catch (error) {
            logger.error(`Failed to destroy workspace "${path}" during flow exit`, { error });
          }
        }
      }
    }
  }
}
