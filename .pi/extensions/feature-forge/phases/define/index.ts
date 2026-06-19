import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Phase } from "../base";
import { State } from "../../state";
import { PiSpawner } from "../../pi-spawner";

const __dir = dirname(fileURLToPath(import.meta.url));
const RESEARCH_TIMEOUT_MS = 180_000;

export class DefinePhase extends Phase {
  readonly name = "define";
  readonly description = "Produce a concrete implementation plan from an issue";

  constructor(pi: ExtensionAPI) {
    super(pi, __dir);
  }

  private async runBackgroundResearch(issueRef: string, cwd: string): Promise<string> {
    const researchPrompt = this.loadAgent("research").replace("{{issueUrl}}", issueRef);
    const spawner = new PiSpawner();
    const { stdout } = await spawner.run(researchPrompt, {
      cwd,
      timeout: RESEARCH_TIMEOUT_MS,
    });
    return stdout;
  }

  async handler(args: string | undefined, ctx: ExtensionCommandContext): Promise<void> {
    const sessionEntries = ctx.sessionManager?.getEntries() ?? [];
    const issueRef = State.getInstance().resolveIssueRef(args, sessionEntries);

    if (!issueRef) {
      ctx.ui.notify(
        "No issue found. Usage: /define <issue-url|issue-number> or run /discover first.",
        "error",
      );
      return;
    }

    let researchOutput: string;
    try {
      ctx.ui.notify("Running background research in separate context...", "info");
      researchOutput = await this.runBackgroundResearch(issueRef, ctx.cwd);
    } catch (err: unknown) {
      ctx.ui.notify(
        `Background research failed: ${err instanceof Error ? err.message : String(err)}. Proceeding without it.`,
        "warning",
      );
      researchOutput =
        "_(Background research could not be completed. Explore the codebase yourself if needed.)_";
    }

    const prompt = this.loadPrompt("main");

    // eslint-disable-next-line @typescript-eslint/await-thenable
    await this.pi.sendUserMessage([
      { type: "text", text: prompt },
      {
        type: "text",
        text: `\n\n## Background research\n\n${researchOutput}\n\n---\n\n**Issue to define**: ${issueRef}\n\nStart by reading the issue.`,
      },
    ]);
  }
}
