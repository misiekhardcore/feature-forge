import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DISCOVERY_PROMPT = `You are conducting a structured feature discovery. Your goal: understand the feature deeply, then produce a compact GitHub issue.

## Interview Guidelines
- Ask one clear question at a time. Wait for the user's answer before asking the next.
- Uncover: who is this for, what problem does it solve, what's the scope, what constraints exist, what does success look like.
- If the user's answer is vague, drill deeper with a follow-up.
- Do research (read code, search docs) if it helps you ask sharper questions.

## When you have a complete picture
- Summarize your understanding back to the user and ask: "Ready to create the issue?"
- On confirmation, run \`gh issue create\` with:
  - \`--title\`: concise, descriptive
  - \`--body\`: compact summary covering problem, scope, constraints, and acceptance criteria
  - \`--label\` (optional): if the repo uses labels
- Print the issue URL when done.

## Tone
- Curious, not presumptuous.
- Don't propose solutions yet — we're still in problem space.`;

interface DiscoverState {
  issueUrl?: string;
  issueNumber?: number;
}

export default function (pi: ExtensionAPI) {
  let state: DiscoverState = {};

  // --- State: reconstruct from session on startup/resume ---
  pi.on("session_start", (_event, ctx) => {
    const entries = ctx.sessionManager.getEntries();
    const issueEntry = entries
      .filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "discover-issue")
      .pop() as { data?: DiscoverState } | undefined;
    if (issueEntry?.data) {
      state = issueEntry.data;
    }
  });

  // --- Capture issue URL from gh issue create ---
  pi.on("tool_result", (event) => {
    if (event.toolName !== "bash") return;
    if (event.isError) return;

    const output = event.content?.map((c: { type: string; text?: string }) => c.text || "").join("") || "";
    const match = output.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/);
    if (!match) return;

    const issueUrl = match[0];
    const issueNumber = parseInt(match[1], 10);
    state = { issueUrl, issueNumber };
    pi.appendEntry("discover-issue", state);
  });

  // --- /discover command ---
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
