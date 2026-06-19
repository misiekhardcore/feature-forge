import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PipelineState, findPipelineIssueUrl } from "./state";
import { isGitHubIssueUrl, isGitHubPrUrl } from "./github";
import { registerPhases } from "./phases/registry";
import { DiscoverPhase } from "./phases/discover";
import { DefinePhase } from "./phases/define";
import { ImplementPhase } from "./phases/implement";

export default function (pi: ExtensionAPI) {
  let state: PipelineState = {};

  // --- Reconstruct pipeline state on session resume ---
  pi.on("session_start", (_event, ctx) => {
    const url = findPipelineIssueUrl(ctx.sessionManager.getEntries());
    if (url) {
      state = { issueUrl: url };
    }
  });

  // --- Capture issue/PR URLs from bash tool output ---
  pi.on("tool_result", (event) => {
    if (event.toolName !== "bash" || event.isError) return;

    const output =
      event.content?.map((c: { type: string; text?: string }) => c.text || "").join("") || "";

    // Check for issue URL first (gh issue create)
    const issueMatch = isGitHubIssueUrl(output);
    if (issueMatch) {
      const issueUrl = issueMatch[0];
      const issueNumber = parseInt(issueMatch[1], 10);
      state = { issueUrl, issueNumber };
      pi.appendEntry("pipeline-issue", state);
      return;
    }

    // Check for PR URL (gh pr create)
    const prMatch = isGitHubPrUrl(output);
    if (prMatch) {
      const prUrl = prMatch[0];
      const prNumber = parseInt(prMatch[1], 10);
      state = { ...state, prUrl, prNumber };
      pi.appendEntry("pipeline-issue", state);
    }
  });

  registerPhases(pi, [new DiscoverPhase(), new DefinePhase(), new ImplementPhase()]);
}
