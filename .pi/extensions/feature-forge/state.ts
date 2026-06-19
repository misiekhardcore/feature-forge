import type {
  ExtensionAPI,
  CustomEntry,
  SessionEntry,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export interface PipelineState {
  issueUrl?: string;
  issueNumber?: number;
  prUrl?: string;
  prNumber?: number;
}

const PIPELINE_ISSUE_TYPE = "pipeline-issue";

/** Extract the pipeline issue URL from session entries (shared across phases). */
export function findPipelineIssueUrl(entries: SessionEntry[]): string | undefined {
  const entry = entries
    .filter(
      (e): e is CustomEntry<PipelineState> =>
        e.type === "custom" && e.customType === PIPELINE_ISSUE_TYPE,
    )
    .pop();
  return entry?.data?.issueUrl;
}

/**
 * Manages pipeline state: persists issue/PR URLs from bash tool output and
 * reconstructs state on session resume.
 */
export class State {
  private state: PipelineState = {};
  private readonly pi: ExtensionAPI;

  constructor(pi: ExtensionAPI) {
    this.pi = pi;
    this.registerEventHandlers();
  }

  private registerEventHandlers(): void {
    this.pi.on("session_start", this.onSessionStart.bind(this));
    this.pi.on("tool_result", this.onToolResult.bind(this));
  }

  private onSessionStart(_event: unknown, ctx: ExtensionContext): void {
    const url = findPipelineIssueUrl(ctx.sessionManager.getEntries());
    if (url) {
      this.state = { issueUrl: url };
    }
  }

  private onToolResult(event: {
    toolName: string;
    isError: boolean;
    content?: { type: string; text?: string }[];
  }): void {
    if (event.toolName !== "bash" || event.isError) return;

    const output =
      event.content?.map((c: { type: string; text?: string }) => c.text || "").join("") || "";

    // Check for issue URL first (gh issue create)
    const issueMatch = output.match(/https?:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/);
    if (issueMatch) {
      const issueUrl = issueMatch[0];
      const issueNumber = parseInt(issueMatch[1], 10);
      this.state = { issueUrl, issueNumber };
      this.pi.appendEntry(PIPELINE_ISSUE_TYPE, this.state);
      return;
    }

    // Check for PR URL (gh pr create)
    const prMatch = output.match(/https?:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
    if (prMatch) {
      const prUrl = prMatch[0];
      const prNumber = parseInt(prMatch[1], 10);
      this.state = { ...this.state, prUrl, prNumber };
      this.pi.appendEntry(PIPELINE_ISSUE_TYPE, this.state);
    }
  }

  getState(): PipelineState {
    return this.state;
  }
}
