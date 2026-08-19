import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AgentSupervisor } from "@feature-forge/core/src/agents";
import { Command } from "@feature-forge/core/src/commands/Command";

export class ResearchCommand extends Command {
  // This command's handler requires a supervisor — CommandRegistry always supplies one.
  declare protected readonly supervisor: AgentSupervisor;
  readonly name = "research";
  readonly description =
    "Spawn a research subagent to investigate a topic in the background. " +
    "Usage: /forge:research <topic>";

  handler = async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
    const topic = args.trim();
    if (!topic) {
      ctx.ui.notify("Usage: /forge:research <topic>", "error");
      return;
    }

    if (!this.specManager) {
      ctx.ui.notify("SpecManager not available — research spec cannot be loaded.", "error");
      return;
    }

    const specification = this.specManager.resolve({
      spec: "research",
    });

    ctx.ui.notify(`Research agent investigating "${topic}" in the background...`, "info");

    return this.supervisor.runAgent(specification, topic, this.pi);
  };
}
