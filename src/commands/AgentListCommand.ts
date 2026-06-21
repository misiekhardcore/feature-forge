import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Command } from "./Command";
import type { CommandDeps } from "../registry";
import { Agent } from "../agents";

export class AgentListCommand extends Command {
  readonly name = "agent:list";
  readonly description = "List all tracked subagents and their current status.";

  constructor(private deps: CommandDeps) {
    super();
  }

  private formatAgentLine(agent: Agent): string {
    return `  • ${agent.identifier} — ${agent.status} (role: ${agent.specification.role})`;
  }

  async execute(_args: string, ctx: ExtensionCommandContext): Promise<void> {
    const agents = this.deps.supervisor.getAllAgents();
    if (agents.length === 0) {
      ctx.ui.notify("No agents currently tracked.", "info");
      return;
    }

    const lines = agents.map(this.formatAgentLine);
    ctx.ui.notify(`Tracked agents (${agents.length}):\n${lines.join("\n")}`, "info");
  }
}
