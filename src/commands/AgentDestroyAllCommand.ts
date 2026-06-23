import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import type { AgentSupervisor } from "../agents";
import { Command } from "./Command";

export class AgentDestroyAllCommand extends Command {
  readonly name = "agent:destroy-all";
  readonly description = "Destroy all tracked subagents.";

  constructor(supervisor: AgentSupervisor) {
    super(supervisor);
  }

  handler = async (_args: string, ctx: ExtensionCommandContext): Promise<void> => {
    const count = this.supervisor.getAllAgents().length;
    await this.supervisor.destroyAll();
    ctx.ui.notify(`All ${count} agent(s) destroyed.`, "info");
  };
}
