import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import type { AgentSupervisor } from "../agents";
import { Command } from "./Command";

export class AgentDestroyAllCommand extends Command {
  // This command's handler requires a supervisor — CommandRegistry always supplies one.
  declare protected readonly supervisor: AgentSupervisor;
  readonly name = "agent:destroy-all";
  readonly description = "Destroy all tracked subprocess agents (in-session personas untouched).";

  handler = async (_args: string, ctx: ExtensionCommandContext): Promise<void> => {
    // In-session personas are not managed as subagents — exit them via
    // /forge:flow:exit (ADR-0007 presentation contract).
    const subprocessAgents = this.supervisor
      .getAllAgents()
      .filter((agent) => agent.kind === "subprocess");
    // allSettled, not all: a single rejecting destroy (e.g. a crashed subprocess
    // whose RPC destroy fails) must not swallow the remaining destroys or skip
    // the user notification — report the fulfilled count instead.
    const results = await Promise.allSettled(
      subprocessAgents.map((agent) => this.supervisor.destroyAgent(agent.id)),
    );
    const destroyed = results.filter((result) => result.status === "fulfilled").length;
    const failed = results.length - destroyed;
    ctx.ui.notify(
      failed === 0
        ? `All ${destroyed} agent(s) destroyed.`
        : `${destroyed} of ${results.length} agent(s) destroyed, ${failed} failed.`,
      failed === 0 ? "info" : "warning",
    );
  };
}
