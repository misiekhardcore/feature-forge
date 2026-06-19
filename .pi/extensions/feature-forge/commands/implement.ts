import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { IMPLEMENT_PROMPTS } from "../prompts";
import { resolveIssueRef } from "../github";

export function registerImplement(pi: ExtensionAPI): void {
  pi.registerCommand("implement", {
    description: "Build, review, verify, and open a PR from an approved issue",
    handler: async (args, ctx) => {
      const sessionEntries = ctx.sessionManager?.getEntries() ?? [];
      const issueRef = resolveIssueRef(args, sessionEntries);

      if (!issueRef) {
        ctx.ui.notify(
          "No issue found. Usage: /implement <issue-url|issue-number> or run /discover + /define first.",
          "error",
        );
        return;
      }

      ctx.ui.notify("Starting implementation coordinator...", "info");

      // eslint-disable-next-line @typescript-eslint/await-thenable
      await pi.sendUserMessage([
        { type: "text", text: IMPLEMENT_PROMPTS.coordinator },
        {
          type: "text",
          text: `\n\n**Issue to implement**: ${issueRef}\n\nRead the issue and start the cycle.`,
        },
      ]);
    },
  });
}
