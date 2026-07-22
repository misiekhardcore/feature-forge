/**
 * Agent lifecycle status within a routine progress event.
 *
 * - `started`: agent has begun executing its task
 * - `done`: agent completed successfully
 * - `error`: agent failed or produced an error result
 */
export type AgentProgressStatus = "started" | "done" | "error";

/**
 * A DTO aggregating routine execution state for progress reporting.
 *
 * Built from {@link import("../RoutineProgress").RoutineProgressEvent} and
 * enriched with iteration and agent tracking data by the
 * {@link import("./ProgressReporter").ProgressReporter} consumers.
 */
export interface ProgressEvent {
  /** Name of the currently executing routine. */
  routineName: string;
  /** Current lifecycle phase (e.g. "agent-started", "loop-round"). */
  phase: string;
  /** Human-readable description of the current progress. */
  message: string;
  /** Current iteration index (0-based). */
  iteration: number;
  /** Maximum number of loop iterations, if this is a looped routine. */
  maxIterations: number;
  /** Agent identifier, set when the event is agent-scoped. */
  agentId?: string;
  /** Agent lifecycle status, set when the event is agent-scoped. */
  agentStatus?: AgentProgressStatus;
  /** Summary text from a completed agent step. */
  agentSummary?: string;
  /** Current workspace path, if one has been provisioned. */
  workspace?: string;
  /** Loop continueWhile expression, if the routine uses a loop. */
  continueWhile?: string;
}
