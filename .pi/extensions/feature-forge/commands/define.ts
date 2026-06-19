import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFINE_PROMPT, researchPrompt } from "../prompts";
import { resolveIssueRef } from "../state";

const RESEARCH_TIMEOUT_MS = 180_000;
const RESEARCH_MAX_BUFFER = 5 * 1024 * 1024;

function runBackgroundResearch(
  issueRef: string,
  cwd: string,
): string {
  const tmpFile = join(tmpdir(), `ff-define-research-${process.pid}.txt`);
  writeFileSync(tmpFile, researchPrompt(issueRef));

  try {
    return execSync(`pi -p "$(<${tmpFile})"`, {
      encoding: "utf-8",
      cwd,
      timeout: RESEARCH_TIMEOUT_MS,
      maxBuffer: RESEARCH_MAX_BUFFER,
      shell: "/bin/bash",
    });
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

export function registerDefine(pi: ExtensionAPI): void {
  pi.registerCommand("define", {
    description: "Produce a concrete implementation plan from an issue",
    handler: async (args, ctx) => {
      const issueRef = resolveIssueRef(
        args,
        ctx.sessionManager.getEntries(),
      );

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
        researchOutput = runBackgroundResearch(issueRef, ctx.cwd);
      } catch (err: any) {
        ctx.ui.notify(
          `Background research failed: ${err.message}. Proceeding without it.`,
          "warning",
        );
        researchOutput = "_(Background research could not be completed. Explore the codebase yourself if needed.)_";
      }

      await pi.sendUserMessage([
        { type: "text", text: DEFINE_PROMPT },
        {
          type: "text",
          text: `\n\n## Background research\n\n${researchOutput}\n\n---\n\n**Issue to define**: ${issueRef}\n\nStart by reading the issue.`,
        },
      ]);
    },
  });
}
