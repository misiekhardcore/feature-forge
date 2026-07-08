import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { SessionAgent } from "../agents/agents/SessionAgent";
import { Command } from "./Command";

/**
 * Exits the currently active flow, restoring the original system prompt and
 * default tools.
 *
 * Finds all active {@link SessionAgent} instances via the supervisor,
 * unmounts each one, and sends an exit instruction to the LLM.
 * If no session agent is mounted, this is a no-op with a notification.
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
      ctx.ui.notify("No active flow to exit.", "info");
      return;
    }

    for (const agent of mountedAgents) {
      agent.unmount();
    }

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
