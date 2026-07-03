import type { ProgressEvent } from "./ProgressEvent";
import { ProgressReporter } from "./ProgressReporter";

/**
 * No-op implementation of {@link ProgressReporter} for non-TUI environments.
 *
 * All methods are empty — events are silently consumed. Used as the
 * default when `ctx.ui` is unavailable (RPC mode, child sessions, etc.).
 */
export class NoOpProgressReporter extends ProgressReporter {
  /** Silently consumes the event. */
  override update(_event: ProgressEvent): void {
    // no-op
  }

  /** No UI to clear. */
  override clear(): void {
    // no-op
  }
}
