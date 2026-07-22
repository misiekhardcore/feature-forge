/**
 * Generic progress-widget surface for routine execution.
 *
 * Implementations drive TUI or no-op rendering. The caller is responsible
 * for formatting lines and status text; the widget only handles
 * throttled rendering and surface lifecycle.
 */
export interface ProgressWidget {
  /** Render the given widget lines and status text to the display surface. */
  render(lines: string[], status: string): void;
  /** Remove all progress-related UI elements from the display surface. */
  clear(): void;
}
