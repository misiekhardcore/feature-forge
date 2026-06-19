import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Phase } from "../base";
import { storeOrResolveIssueRef } from "../../state";

const __dir = dirname(fileURLToPath(import.meta.url));

export class ImplementPhase extends Phase {
  readonly name = "implement";
  readonly description = "Build, review, verify, and open a PR from an approved issue";

  constructor(pi: ExtensionAPI) {
    super(pi, __dir);
  }

  async handler(args: string | undefined, ctx: ExtensionCommandContext): Promise<void> {
    const sessionEntries = ctx.sessionManager?.getEntries() ?? [];
    const issueRef = storeOrResolveIssueRef(this.pi, args, sessionEntries);

    if (!issueRef) {
      ctx.ui.notify(
        "No issue found. Usage: /implement <issue-url|issue-number> or run /discover + /define first.",
        "error",
      );
      return;
    }

    ctx.ui.notify("Starting implementation coordinator...", "info");

    const coordinator = this.loadPrompt("coordinator");

    // eslint-disable-next-line @typescript-eslint/await-thenable
    await this.pi.sendUserMessage([
      { type: "text", text: coordinator },
      {
        type: "text",
        text: `\n\n**Issue to implement**: ${issueRef}\n\nRead the issue and start the cycle.`,
      },
    ]);
  }
}
