import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { Command } from "./Command";

export class AgentDestroyCommand extends Command {
  readonly name = "agent:destroy";
  readonly description = "Destroy a specific subagent. Usage: /agent:destroy <name>";

  handler = async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
    const name = args.trim();
    if (!name) {
      ctx.ui.notify("Usage: /agent:destroy <name>", "error");
      return;
    }

    await this.supervisor.destroyAgent(name);
    ctx.ui.notify(`🗑️ Agent "${name}" destroyed.`, "info");
  };
}
