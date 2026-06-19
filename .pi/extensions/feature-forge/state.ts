import type {
  ExtensionAPI,
  CustomEntry,
  SessionEntry,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { expandBareIssueNumber, isGitHubIssueUrl, isGitHubPrUrl } from "./github";

export interface PipelineState {
  issueUrl?: string;
  issueNumber?: number;
  prUrl?: string;
  prNumber?: number;
}

const PIPELINE_ISSUE_TYPE = "pipeline-issue";

/**
 * Manages pipeline state: persists issue/PR URLs from bash tool output and
 * reconstructs state on session resume.
 */
export class State {
  private state: PipelineState = {};
  private pi: ExtensionAPI;
  private static instance: State | null = null;

  private constructor(pi: ExtensionAPI) {
    this.pi = pi;
    this.registerEventHandlers();
  }

  static initialize(pi: ExtensionAPI): State {
    if (State.instance) {
      return State.instance;
    }
    State.instance = new State(pi);
    return State.instance;
  }

  /** Reset the singleton (testing only). */
  static reset(): void {
    State.instance = null;
  }

  static getInstance(): State {
    if (!State.instance) {
      throw new Error(
        "State not initialized. Call State.initialize(pi) in your extension's default function.",
      );
    }
    return State.instance;
  }

  getPi(): ExtensionAPI {
    return this.pi;
  }

  setPi(pi: ExtensionAPI): void {
    this.pi = pi;
  }

  private registerEventHandlers(): void {
    this.pi.on("session_start", this.onSessionStart);
    this.pi.on("tool_result", this.onToolResult);
  }

  private onSessionStart = (_event: unknown, ctx: ExtensionContext): void => {
    const url = State.extractIssueUrl(ctx.sessionManager.getEntries());
    if (url) {
      this.state = { issueUrl: url };
    }
  };

  private onToolResult = (event: {
    toolName: string;
    isError: boolean;
    content?: { type: string; text?: string }[];
  }): void => {
    if (event.toolName !== "bash" || event.isError) return;

    const output =
      event.content?.map((c: { type: string; text?: string }) => c.text || "").join("") || "";

    // Check for issue URL first (gh issue create)
    const issueMatch = isGitHubIssueUrl(output);
    if (issueMatch) {
      const issueUrl = issueMatch[0];
      const issueNumber = parseInt(issueMatch[1], 10);
      this.state = { issueUrl, issueNumber };
      this.pi.appendEntry(PIPELINE_ISSUE_TYPE, this.state);
      return;
    }

    // Check for PR URL (gh pr create)
    const prMatch = isGitHubPrUrl(output);
    if (prMatch) {
      const prUrl = prMatch[0];
      const prNumber = parseInt(prMatch[1], 10);
      this.state = { ...this.state, prUrl, prNumber };
      this.pi.appendEntry(PIPELINE_ISSUE_TYPE, this.state);
    }
  };

  static extractIssueUrl(entries: SessionEntry[]): string | undefined {
    const entry = entries
      .filter(
        (e): e is CustomEntry<PipelineState> =>
          e.type === "custom" && e.customType === PIPELINE_ISSUE_TYPE,
      )
      .pop();
    return entry?.data?.issueUrl;
  }

  /** Expose current state for inspection. */
  getState(): PipelineState {
    return this.state;
  }

  /**
   * Resolve an issue reference and persist it to pipeline state.
   * Phase handlers should call this instead of resolveIssueRef so the
   * pipeline state is always up to date.
   */
  resolveIssueRef = (args: string | undefined, entries: SessionEntry[]): string | undefined => {
    let ref: string | undefined;

    if (args && args.trim()) {
      ref = expandBareIssueNumber(args.trim());
    } else {
      ref = State.extractIssueUrl(entries);
    }

    if (!ref) {
      return undefined;
    }

    const issueNumberMatch = ref.match(/issues\/(\d+)/);
    const issueNumber = issueNumberMatch ? parseInt(issueNumberMatch[1], 10) : undefined;
    this.pi.appendEntry(PIPELINE_ISSUE_TYPE, { issueUrl: ref, issueNumber });
    return ref;
  };
}
