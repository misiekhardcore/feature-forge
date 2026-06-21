import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Command } from "./Command";
import type { CommandDeps } from "../registry";
import { ResearchAgentSpecification } from "../agents";

export class ResearchCommand extends Command {
  readonly name = "research";
  readonly description =
    "Spawn a research subagent to investigate a topic in the background. " +
    "Usage: /research <topic>";

  constructor(private deps: CommandDeps) {
    super();
  }

  async execute(args: string, ctx: ExtensionCommandContext): Promise<void> {
    const topic = args.trim();
    if (!topic) {
      ctx.ui.notify("Usage: /research <topic>", "error");
      return;
    }

    const specification = new ResearchAgentSpecification();

    ctx.ui.notify(`Research agent investigating "${topic}" in the background...`, "info");

    this.deps.supervisor.runAgent(specification, topic, this.deps.pi);
  }
}
