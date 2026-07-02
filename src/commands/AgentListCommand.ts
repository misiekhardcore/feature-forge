import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import type { Agent } from "../agents";
import { getRole } from "../agents";
import { Command } from "./Command";

export class AgentListCommand extends Command {
  readonly name = "agent:list";
  readonly description = "List all tracked agents and their current status.";

  private formatElapsed(createdAt: Date): string {
    const ms = Date.now() - createdAt.getTime();
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }

  private formatAgentLine(agent: Agent): string {
    const elapsed = this.formatElapsed(agent.createdAt);
    return `  • ${agent.id} — ${agent.status} (role: ${getRole(agent)}) [${elapsed}]`;
  }

  handler = async (_args: string, ctx: ExtensionCommandContext): Promise<void> => {
    const agents = this.supervisor.getAllAgents();
    if (agents.length === 0) {
      ctx.ui.notify("No agents currently tracked.", "info");
      return;
    }

    const lines = agents.map((agent) => this.formatAgentLine(agent));
    ctx.ui.notify(`Tracked agents (${agents.length}):\n${lines.join("\n")}`, "info");
  };
}
