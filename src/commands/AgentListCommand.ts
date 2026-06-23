import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import type { Agent, AgentSupervisor } from "../agents";
import { Command } from "./Command";

export class AgentListCommand extends Command {
  readonly name = "agent:list";
  readonly description = "List all tracked subagents and their current status.";

  constructor(private supervisor: AgentSupervisor) {
    super();
  }

  private formatAgentLine(agent: Agent): string {
    return `  • ${agent.identifier} — ${agent.status} (role: ${agent.specification.role})`;
  }

  async handler(_args: string, ctx: ExtensionCommandContext): Promise<void> {
    const agents = this.supervisor.getAllAgents();
    if (agents.length === 0) {
      ctx.ui.notify("No agents currently tracked.", "info");
      return;
    }

    const lines = agents.map((agent) => this.formatAgentLine(agent));
    ctx.ui.notify(`Tracked agents (${agents.length}):\n${lines.join("\n")}`, "info");
  }
}
