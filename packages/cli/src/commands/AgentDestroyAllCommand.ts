import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import type { AgentSupervisor } from "../agents";
import { Command } from "./Command";

export class AgentDestroyAllCommand extends Command {
  // This command's handler requires a supervisor — CommandRegistry always supplies one.
  declare protected readonly supervisor: AgentSupervisor;
  readonly name = "agent:destroy-all";
  readonly description = "Destroy all tracked subagents.";

  handler = async (_args: string, ctx: ExtensionCommandContext): Promise<void> => {
    const count = this.supervisor.getAllAgents().length;
    await this.supervisor.destroyAll();
    ctx.ui.notify(`All ${count} agent(s) destroyed.`, "info");
  };
}
