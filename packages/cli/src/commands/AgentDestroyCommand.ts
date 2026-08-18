import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AgentSupervisor } from "@feature-forge/core/src/agents";

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

    const agent = this.supervisor.getAgent(name);
    if (agent && agent.kind !== "subprocess") {
      // In-session personas end via /forge:flow:exit — destroying them here
      // would leave the live session without its persona teardown.
      ctx.ui.notify(
        `Agent "${name}" is an in-session agent - use /forge:flow:exit to end the flow.`,
        "error",
      );
      return;
    }

    await this.supervisor.destroyAgent(name);
    ctx.ui.notify(`🗑️ Agent "${name}" destroyed.`, "info");
  };
}
