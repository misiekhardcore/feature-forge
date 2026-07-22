import type { ProgressEvent } from "./ProgressEvent";
import { ProgressReporter } from "./ProgressReporter"
import type { ProgressWidget } from "@feature-forge/tui";

/**
 * No-op implementation of {@link ProgressReporter} for non-TUI environments.
 *
 * All methods are empty — events are silently consumed. Used as the
 * default when `ctx.ui` is unavailable (RPC mode, child sessions, etc.).
 *
 * Also implements {@link ProgressWidget} so it can be used interchangeably
 * with {@link import("./TuiProgressReporter").TuiRoutineWidget} by callers
 * that only need widget rendering.
 */
export class NoOpProgressReporter extends ProgressReporter implements ProgressWidget {
  /** Silently consumes the event. */
  override update(_event: ProgressEvent): void {
    // no-op
  }

  /** No UI to clear. */
  override clear(): void {
    // no-op
  }

  /** Silently consumes the render call. */
  render(_lines: string[], _status: string): void {
    // no-op
  }
}
