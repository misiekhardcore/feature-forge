import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DISCOVERY_PROMPT } from "../prompts";

export function registerDiscover(pi: ExtensionAPI): void {
  pi.registerCommand("discover", {
    description: "Interactive feature discovery interview → GitHub issue",
    handler: async (args, ctx) => {
      if (!args || !args.trim()) {
        ctx.ui.notify("Usage: /discover <feature idea>", "error");
        return;
      }

      const idea = args.trim();

      await pi.sendUserMessage([
        { type: "text", text: DISCOVERY_PROMPT },
        { type: "text", text: `\n\n**Feature idea to explore**: ${idea}\n\nStart by asking your first question.` },
      ]);
    },
  });
}
