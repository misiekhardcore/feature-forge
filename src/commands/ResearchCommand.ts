import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import type { AgentSupervisor } from "../agents";
import { ResearchAgentSpecification } from "../agents";
import { Command } from "./Command";

export class ResearchCommand extends Command {
  readonly name = "research";
  readonly description =
    "Spawn a research subagent to investigate a topic in the background. " +
    "Usage: /research <topic>";

  constructor(supervisor: AgentSupervisor, pi?: ExtensionAPI) {
    super(supervisor, pi);
  }

  handler = async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
    const topic = args.trim();
    if (!topic) {
      ctx.ui.notify("Usage: /research <topic>", "error");
      return;
    }

    const specification = new ResearchAgentSpecification();

    ctx.ui.notify(`Research agent investigating "${topic}" in the background...`, "info");

    return this.supervisor.runAgent(specification, topic, this.pi);
  };
}
