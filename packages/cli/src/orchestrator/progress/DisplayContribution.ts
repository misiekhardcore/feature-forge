import type { AgentEvent } from "@earendil-works/pi-agent-core";

/**
 * A DTO returned by {@link import("../StepExecutor").StepExecutor.getDisplayContribution}
 * carrying display-relevant fields extracted from a
 * {@link import("../RoutineProgress").RoutineProgressEvent}.
 *
 * Each executor populates only the subset it owns. The consumer merges
 * contributions into an accumulated state snapshot for rendering via a
 * {@link import("./DisplayContributionRegistry").DisplayContributionRegistry}.
 *
 * This is a discriminated union — consumers narrow by checking the `type`
 * field before accessing variant-specific fields.
 */

/** Contribution from an "agent" step — tracks agent lifecycle, status and stream events. */
export interface AgentContribution {
  readonly type: "agent";
  /** Unique execution identifier from the agent step. */
  executionId?: string;
  /** Agent instruction id. */
  agentId: string;
  /** Agent lifecycle status ("started" | "done" | "error"). */
  agentStatus: string;
  /** Summary text from a completed agent step. */
  agentSummary?: string;
  /** Whether the agent's parsed result passed (undefined when not available). */
  agentPassed?: boolean;
  /** Raw stream event payload from an agent-stream event. */
  streamEvent?: AgentEvent;
  /** The event phase label (e.g. "agent-started"). */
  phase: string;
  /** Human-readable description of the current progress. */
  message: string;
}

/** Contribution from a "loop" step — tracks iteration state and continuation condition. */
export interface LoopContribution {
  readonly type: "loop";
  /** Current iteration index (0-based). */
  iteration: number;
  /** Maximum number of loop iterations. */
  maxIterations: number;
  /** The `continueWhile` expression from the loop instruction, if any. */
  continueWhile?: string;
  /** The event phase label (e.g. "loop-round-start"). */
  phase: string;
  /** Human-readable description of the current progress. */
  message: string;
}

/** Contribution from a "workspace" step — tracks workspace path and branch. */
export interface WorkspaceContribution {
  readonly type: "workspace";
  /** Workspace path. */
  workspace: string;
  /** Branch name associated with the workspace, if set. */
  branch?: string;
  /** The event phase label (e.g. "workspace-ready"). */
  phase: string;
  /** Human-readable description of the current progress. */
  message: string;
}

/** Contribution for generic status updates — cleanup, shell, or other non-agent/non-loop events. */
export interface StatusContribution {
  readonly type: "status";
  /** Optional workspace path (e.g. from cleanup-done event). */
  workspace?: string;
  /** The event phase label (e.g. "cleanup-done", "shell-done"). */
  phase: string;
  /** Human-readable description of the current progress. */
  message: string;
}

export type DisplayContribution =
  | AgentContribution
  | LoopContribution
  | WorkspaceContribution
  | StatusContribution;
