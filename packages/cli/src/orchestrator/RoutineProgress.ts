import type { RoutineResult } from "./RoutineResult";

/**
 * A granular progress update emitted during routine execution.
 *
 * Each event carries a `phase` identifier, a human-readable `message`,
 * and a `details` object built from the current state of the
 * {@link import("./FlowContext").FlowContext} at that point.
 */
export interface RoutineProgressEvent {
  /** Identifies the lifecycle phase (e.g. "agent-started", "loop-round"). */
  phase: string;
  /** Human-readable description of the current progress. */
  message: string;
  /** Partial routine result reflecting the context state at this point. */
  details: Partial<RoutineResult>;
}
