import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Phase } from "../base";

const __dir = dirname(fileURLToPath(import.meta.url));

export class DiscoverPhase extends Phase {
  readonly name = "discover";
  readonly description = "Interactive feature discovery interview → GitHub issue";

  constructor() {
    super(__dir);
  }

  async handler(args: string | undefined, ctx: ExtensionCommandContext): Promise<void> {
    const idea = args?.trim();
    if (!idea) {
      ctx.ui.notify("Usage: /discover <feature idea>", "error");
      return Promise.resolve();
    }

    const prompt = this.loadPrompt("main");

    this.pi.sendUserMessage([
      { type: "text", text: prompt },
      {
        type: "text",
        text: `\n\n**Feature idea to explore**: ${idea}\n\nStart by asking your first question.`,
      },
    ]);
  }
}
