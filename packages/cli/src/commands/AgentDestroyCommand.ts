import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import type { AgentSupervisor } from "../agents";
import { Command } from "./Command";

export class AgentDestroyCommand extends Command {
  // This command's handler requires a supervisor — CommandRegistry always supplies one.
  declare protected readonly supervisor: AgentSupervisor;
  readonly name = "agent:destroy";
  readonly description = "Destroy a specific subagent. Usage: /forge:agent:destroy <name>";

  handler = async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
    const name = args.trim();
    if (!name) {
      ctx.ui.notify("Usage: /forge:agent:destroy <name>", "error");
      return;
    }

    await this.supervisor.destroyAgent(name);
    ctx.ui.notify(`🗑️ Agent "${name}" destroyed.`, "info");
  };
}
