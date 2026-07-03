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
 * Abstract port for routine progress reporting.
 *
 * Concrete implementations drive different rendering targets:
 * {@link import("./TuiProgressReporter").TuiProgressReporter} for TUI
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
    return {
      routineName: "",
      phase: "",
      message: "",
      iteration: 0,
      maxIterations: 0,
      agents: new Map(),
    };
  }
}
