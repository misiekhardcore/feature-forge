import type { ProgressEvent } from "./ProgressEvent";

/**
 * Accumulated state snapshot returned by {@link ProgressReporter.getState}.
 *
 * Callers that need a read-only view of the latest progress can use this
 * to build their own rendering outputs (e.g. compact tool-row status lines).
 */
export interface ProgressSnapshot {
  routineName: string;
  phase: string;
  message: string;
  iteration: number;
  maxIterations: number;
  continueWhile?: string;
  workspace?: string;
  agents: Map<string, { status: string; summary?: string }>;
}

/**
 * A pre-initialized empty snapshot suitable as a default return value.
 *
 * Used by {@link NoOpProgressReporter} and other consumers that need an
 * empty snapshot without constructing a fresh one each time.
 */
export const EMPTY_PROGRESS_SNAPSHOT: ProgressSnapshot = {
  routineName: "",
  phase: "",
  message: "",
  iteration: 0,
  maxIterations: 0,
  agents: new Map(),
};

/**
 * Abstract port for routine progress reporting.
 *
 * Concrete implementations drive different rendering targets:
 * {@link import("./TuiProgressReporter").TuiRoutineWidget} for TUI
 * widgets and status bars, {@link import("./NoOpProgressReporter").NoOpProgressReporter}
 * for non-TUI environments.
 */
export abstract class ProgressReporter {
  /**
   * Consume a progress event and update the rendering surface.
   *
   * Implementations should accumulate agent state and iteration info
   * from the event and drive their target display.
   */
  abstract update(event: ProgressEvent): void;

  /**
   * Remove all progress-related UI elements.
   *
   * Called when the routine finishes (or is cancelled) so the screen
   * returns to its normal state.
   */
  abstract clear(): void;

  /**
   * Return a read-only snapshot of accumulated progress state.
   *
   * Default implementation is a no-op that returns an empty snapshot.
   * Subclasses that track state should override this.
   */
  getState(): ProgressSnapshot {
    return EMPTY_PROGRESS_SNAPSHOT;
  }
}
