import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DiscoverState, findDiscoverIssueUrl } from "./state";
import { registerDiscover } from "./commands/discover";

export default function (pi: ExtensionAPI) {
  let state: DiscoverState = {};

  // --- Reconstruct /discover state on session resume ---
  pi.on("session_start", (_event, ctx) => {
    const url = findDiscoverIssueUrl(ctx.sessionManager.getEntries());
    if (url) {
      state = { issueUrl: url };
    }
  });

  // --- Capture issue URL from gh issue create output ---
  pi.on("tool_result", (event) => {
    if (event.toolName !== "bash" || event.isError) return;

    const output = event.content?.map((c: { type: string; text?: string }) => c.text || "").join("") || "";
    const match = output.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/);
    if (!match) return;

    const issueUrl = match[0];
    const issueNumber = parseInt(match[1], 10);
    state = { issueUrl, issueNumber };
    pi.appendEntry("discover-issue", state);
  });

  registerDiscover(pi);
}
