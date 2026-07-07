import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { Command } from "./Command";

export class ResearchCommand extends Command {
  readonly name = "research";
  readonly description =
    "Spawn a research subagent to investigate a topic in the background. " +
    "Usage: /research <topic>";

  handler = async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
    const topic = args.trim();
    if (!topic) {
      ctx.ui.notify("Usage: /research <topic>", "error");
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
