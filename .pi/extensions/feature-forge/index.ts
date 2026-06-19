import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DiscoverState, findDiscoverIssueUrl } from "./state";
import { registerDiscover } from "./commands/discover";

const RESEARCH_PROMPT = (
  issueUrl: string,
) => `Background research only. Do NOT propose solutions, architecture decisions, or write code.

Read the GitHub issue: ${issueUrl}

Then explore the codebase:
- Tech stack, conventions, and tooling
- File structure, naming patterns, code organization
- Existing code adjacent to the feature area — similar components, related modules, shared utilities 
- Constraints, gotchas, patterns to follow or avoid

Produce a concise markdown summary. Only include what's relevant to the issue. Be specific: name files, patterns, and functions.`;

const DEFINE_PROMPT = `You are leading the definition phase. Your goal: turn an approved issue into a concrete, technical implementation plan so /implement can code it without stopping to ask design questions.

## Process

### 1. Read the issue
Read the GitHub issue body. Understand the problem, scope, and acceptance criteria.

### 2. Review the background research
The background research has already been run in a separate context (see below). Review it. If anything is unclear or missing, do a quick targeted exploration — but don't redo the research.

### 3. Produce the implementation plan (see sections below)
For each section that applies to this feature, produce concrete, specific detail. Skip sections that don't apply (e.g., no UI work means no Design section).

### 4. Discuss with the user
Present the full plan in chat. Do NOT post to the issue yet. Ask for feedback. Iterate until the user explicitly approves with "approved" or "LGTM".

### 5. Commit
On approval, update the GitHub issue by appending \`## Implementation plan\` with the final plan. Use \`gh issue edit\` or \`gh issue comment\` — whichever fits.

## Implementation plan sections

Cover whichever apply to this feature. Skip the rest.

### Background research
Summary of relevant findings from the pre-completed codebase exploration. Existing patterns, conventions, constraints, adjacent code.

### Architecture
Components, modules, or services involved. How they connect. Data flow between them. What changes and what stays the same.

### Design
UI layout, interaction flows, component tree. Visual changes and how the user interacts with them.

### Data model
Types, interfaces, schemas, database changes, state shape. Be concrete — write the actual type definitions if relevant.

### API / interface surface
Endpoints, function signatures, contracts between components. New APIs, changed APIs, removed APIs.

### File plan
Exact files to create, modify, or delete. Organize by action.

### Work order
Dependency graph — what must be built first, what can happen in parallel, what depends on what. Ordered list of steps.

### Risks & unknowns
What's uncertain, what could break, edge cases to watch for, assumptions that need validation.

## Rules
- Be concrete. Name specific files, functions, types, API paths.
- Flag unknowns explicitly rather than guessing.
- Skip sections that don't apply — don't pad with filler.
- Do not write implementation code. This is planning only.
- Get explicit approval before updating the issue.`;


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

    const output =
      event.content?.map((c: { type: string; text?: string }) => c.text || "").join("") || "";
    const match = output.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/);
    if (!match) return;

    const issueUrl = match[0];
    const issueNumber = parseInt(match[1], 10);
    state = { issueUrl, issueNumber };
    pi.appendEntry("discover-issue", state);
  });

  registerDiscover(pi);
  // --- /define command ---
  pi.registerCommand("define", {
    description: "Produce a concrete implementation plan from an issue",
    handler: async (args, ctx) => {
      // Resolve issue: from args, from /discover state, or ask user
      let issueRef: string | undefined;

      if (args && args.trim()) {
        issueRef = args.trim();
        // If bare number, construct URL from repo remote
        if (/^\d+$/.test(issueRef)) {
          try {
            const { execSync } = await import("node:child_process");
            const remote = execSync("git remote get-url origin", { encoding: "utf-8" }).trim();
            const repoMatch = remote.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
            if (repoMatch) {
              issueRef = `https://github.com/${repoMatch[1]}/issues/${issueRef}`;
            }
          } catch {
            // Leave as-is, LLM will handle it
          }
        }
      } else {
        // Check /discover state
        const entries = ctx.sessionManager.getEntries();
        const issueEntry = entries
          .filter(
            (e: { type: string; customType?: string }) =>
              e.type === "custom" && e.customType === "discover-issue",
          )
          .pop() as { data?: { issueUrl?: string; issueNumber?: number } } | undefined;
        if (issueEntry?.data?.issueUrl) {
          issueRef = issueEntry.data.issueUrl;
        }
      }

      if (!issueRef) {
        ctx.ui.notify(
          "No issue found. Usage: /define <issue-url|issue-number> or run /discover first.",
          "error",
        );
        return;
      }

      // --- Run background research in a separate pi process ---
      ctx.ui.notify("Running background research in separate context...", "info");

      let researchOutput: string;
      try {
        const { execSync } = await import("node:child_process");
        const { writeFileSync, unlinkSync } = await import("node:fs");
        const { tmpdir } = await import("node:os");
        const { join } = await import("node:path");

        const tmpFile = join(tmpdir(), `ff-define-research-${process.pid}.txt`);
        writeFileSync(tmpFile, RESEARCH_PROMPT(issueRef));

        try {
          researchOutput = execSync(`pi -p "$(<${tmpFile})"`, {
            encoding: "utf-8",
            cwd: ctx.cwd,
            timeout: 180_000,
            maxBuffer: 5 * 1024 * 1024,
            shell: "/bin/bash",
          });
        } finally {
          try {
            unlinkSync(tmpFile);
          } catch {
            /* ignore */
          }
        }
      } catch (err: any) {
        ctx.ui.notify(
          `Background research failed: ${err.message}. Proceeding without it.`,
          "warning",
        );
        researchOutput =
          "_(Background research could not be completed. Explore the codebase yourself if needed.)_";
      }

      // --- Send define prompt with research context ---
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
