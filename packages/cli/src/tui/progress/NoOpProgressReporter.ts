import type { ProgressWidget } from "./ProgressWidget";

/**
 * No-op implementation of {@link ProgressWidget} for non-TUI environments.
 *
 * All methods are empty — renders are silently consumed. Used as the
 * default when `ctx.ui` is unavailable (RPC mode, child sessions, etc.).
 */
export class NoOpProgressReporter implements ProgressWidget {
  /** No UI to clear. */
  clear(): void {
    // no-op
  }

  /** Silently consumes the render call. */
  render(_lines: string[], _status: string): void {
    // no-op
  }
}
