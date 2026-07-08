import type { AgentEvent } from "@earendil-works/pi-agent-core";
/**
 * A DTO returned by {@link import("../StepExecutor").StepExecutor.getDisplayContribution}
 * carrying display-relevant fields extracted from a
 * {@link import("../RoutineProgress").RoutineProgressEvent}.
 *
 * All fields are optional — each executor populates only the subset
 * it owns (agents track agentId/agentStatus, loops track iteration, etc.).
 * The consumer merges contributions into an accumulated state snapshot
 * for rendering.
 */
export interface DisplayContribution {
  /** Unique execution identifier from the agent step that produced this event. */
  executionId?: string;
  /** Agent instruction id, set when the event is agent-scoped. */
  agentId?: string;
  /** Agent lifecycle status ("started" | "done" | "error"). */
  agentStatus?: string;
  /** Summary text from a completed agent step. */
  agentSummary?: string;
  /** Whether the agent's parsed result passed (undefined when not available). */
  agentPassed?: boolean;
  /** Current iteration index (0-based). */
  iteration?: number;
  /** Maximum number of loop iterations. */
  maxIterations?: number;
  /** Workspace path, if one has been provisioned. */
  workspace?: string;
  /** The event phase label (e.g. "agent-started"). */
  phase?: string;
  /** Human-readable description of the current progress. */
  message?: string;
  /** The `continueWhile` expression from the loop instruction, if any. */
  continueWhile?: string;
  /** Raw stream event payload from an agent-stream event. */
  streamEvent?: AgentEvent;
}
