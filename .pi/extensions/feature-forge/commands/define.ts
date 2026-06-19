import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFINE_PROMPT, researchPrompt } from "../prompts";
import { resolveIssueRef } from "../github";

const RESEARCH_TIMEOUT_MS = 180_000;
const RESEARCH_MAX_BUFFER = 5 * 1024 * 1024;

export function runBackgroundResearch(issueRef: string, cwd: string): string {
  const tmpFile = join(tmpdir(), `ff-define-research-${process.pid}.txt`);
  writeFileSync(tmpFile, researchPrompt(issueRef));
  const cleanup = () => {
    try {
      unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  };
  process.once("exit", cleanup);

  try {
    return execSync(`pi -p "$(<${tmpFile})"`, {
      encoding: "utf-8",
      cwd,
      timeout: RESEARCH_TIMEOUT_MS,
      maxBuffer: RESEARCH_MAX_BUFFER,
      shell: "/bin/bash",
    });
  } finally {
    process.off("exit", cleanup);
    cleanup();
  }
}

export function registerDefine(pi: ExtensionAPI): void {
  pi.registerCommand("define", {
    description: "Produce a concrete implementation plan from an issue",
    handler: async (args, ctx) => {
      const sessionEntries = ctx.sessionManager?.getEntries() ?? [];
      const issueRef = resolveIssueRef(args, sessionEntries);

      if (!issueRef) {
        ctx.ui.notify(
          "No issue found. Usage: /define <issue-url|issue-number> or run /discover first.",
          "error",
        );
        return Promise.resolve();
      }

      let researchOutput: string;
      try {
        ctx.ui.notify("Running background research in separate context...", "info");
        researchOutput = runBackgroundResearch(issueRef, ctx.cwd);
      } catch (err: unknown) {
        ctx.ui.notify(
          `Background research failed: ${err instanceof Error ? err.message : String(err)}. Proceeding without it.`,
          "warning",
        );
        researchOutput =
          "_(Background research could not be completed. Explore the codebase yourself if needed.)_";
      }

      pi.sendUserMessage([
        { type: "text", text: DEFINE_PROMPT },
        {
          type: "text",
          text: `\n\n## Background research\n\n${researchOutput}\n\n---\n\n**Issue to define**: ${issueRef}\n\nStart by reading the issue.`,
        },
      ]);
    },
  });
}
