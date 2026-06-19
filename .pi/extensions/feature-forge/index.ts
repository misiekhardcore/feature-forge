import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PipelineState, findPipelineIssueUrl } from "./state";
import { registerDiscover } from "./commands/discover";
import { registerDefine } from "./commands/define";
import { isGitHubIssueUrl } from "./github";

export default function (pi: ExtensionAPI) {
  let state: PipelineState = {};

  // --- Reconstruct pipeline state on session resume ---
  pi.on("session_start", (_event, ctx) => {
    const url = findPipelineIssueUrl(ctx.sessionManager.getEntries());
    if (url) {
      state = { issueUrl: url };
    }
  });

  // --- Capture issue URL from gh issue create output ---
  pi.on("tool_result", (event) => {
    if (event.toolName !== "bash" || event.isError) return;

    const output =
      event.content?.map((c: { type: string; text?: string }) => c.text || "").join("") || "";
    const match = isGitHubIssueUrl(output);
    if (!match) return;

    const issueUrl = match[0];
    const issueNumber = parseInt(match[1], 10);
    state = { issueUrl, issueNumber };
    pi.appendEntry("pipeline-issue", state);
  });

  registerDiscover(pi);
  registerDefine(pi);
}
