import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Command } from "./Command";
import type { CommandDeps } from "../registry";

export class AgentDestroyAllCommand extends Command {
  readonly name = "agent:destroy-all";
  readonly description = "Destroy all tracked subagents.";

  constructor(private deps: CommandDeps) {
    super();
  }

  async execute(_args: string, ctx: ExtensionCommandContext): Promise<void> {
    const count = this.deps.supervisor.getAllAgents().length;
    await this.deps.supervisor.destroyAll();
    ctx.ui.notify(`All ${count} agent(s) destroyed.`, "info");
  }
}
