import type { AgentEvent } from "@earendil-works/pi-agent-core";

/**
 * Display contribution from an agent step executor.
 *
 * Produced for agent-started, agent-done, and agent-stream events.
 */
export interface AgentContribution {
  readonly type: "agent";
  /** Unique execution identifier from the agent step. */
  readonly executionId?: string;
  /** Agent instruction id. */
  readonly agentId: string;
  /** Agent lifecycle status ("started" | "done"), undefined for stream-only events. */
  readonly agentStatus?: string;
  /** Summary text from a completed agent step. */
  readonly agentSummary?: string;
  /** Whether the agent's parsed result passed (undefined when not available). */
  readonly agentPassed?: boolean;
  /** Raw stream event payload from an agent-stream event. */
  readonly streamEvent?: AgentEvent;
  /** The event phase label (e.g. "agent-started"). */
  readonly phase?: string;
  /** Human-readable description of the current progress. */
  readonly message?: string;
}

/**
 * Display contribution from a loop step executor.
 *
 * Produced for loop-round-start and loop-round-complete events.
 */
export interface LoopContribution {
  readonly type: "loop";
  /** Current iteration index (0-based). */
  readonly iteration: number;
  /** Maximum number of loop iterations. */
  readonly maxIterations: number;
  /** The continueWhile expression from the loop instruction, if any. */
  readonly continueWhile?: string;
  /** The event phase label (e.g. "loop-round-start"). */
  readonly phase?: string;
  /** Human-readable description of the current progress. */
  readonly message?: string;
}

/**
 * Display contribution from a workspace step executor.
 *
 * Produced for workspace-ready events.
 */
export interface WorkspaceContribution {
  readonly type: "workspace";
  /** Workspace path on disk. */
  readonly workspace: string;
  /** Branch name associated with the workspace, if set. */
  readonly branch?: string;
  /** The event phase label (e.g. "workspace-ready"). */
  readonly phase?: string;
  /** Human-readable description of the current progress. */
  readonly message?: string;
}

/**
 * Display contribution from status-only events (cleanup, shell, git).
 *
 * Produced for cleanup-done, shell-done, and similar terminal events
 * that carry no structural state but may carry metadata like a PR URL.
 */
export interface StatusContribution {
  readonly type: "status";
  /** The event phase label (e.g. "cleanup-done", "shell-done"). */
  readonly phase?: string;
  /** Human-readable description of the current progress. */
  readonly message?: string;
  /** PR URL extracted from a shell command output, if any. */
  readonly prUrl?: string;
  /** Workspace path reported by a cleanup event, if available. */
  readonly workspace?: string;
}

/**
 * A discriminated union of all possible display contribution types.
 *
 * Each variant carries a `type` discriminant used by
 * {@link import("./DisplayContributionRegistry").DisplayContributionRegistry}
 * for dispatch.
 */
export type DisplayContribution =
  | AgentContribution
  | LoopContribution
  | WorkspaceContribution
  | StatusContribution;
