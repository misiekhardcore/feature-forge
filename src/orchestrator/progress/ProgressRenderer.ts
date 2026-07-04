import type { Theme } from "@earendil-works/pi-coding-agent";

/**
 * Pure rendering functions for routine progress display.
 *
 * These functions build widget lines and status text from accumulated
 * display state. They are stateless and theme-aware — the consumer is
 * responsible for accumulating contributions and calling these builders
 * whenever a re-render is needed.
 */

/**
 * Map an agent status to a theme-coloured icon character.
 *
 * - `"done"` → success green ✓
 * - `"started"` → warning yellow ⏳
 * - `"error"` → error red ✗
 * - anything else → muted grey ○
 */
export function statusIcon(status: string | undefined, theme: Theme): string {
  switch (status) {
    case "done":
      return theme.fg("success", "✓");
    case "started":
      return theme.fg("warning", "⏳");
    case "error":
      return theme.fg("error", "✗");
    default:
      return theme.fg("muted", "○");
  }
}

/**
 * Parameters for {@link buildWidgetLines}.
 */
export interface BuildWidgetLinesParams {
  /** Theme for colouring UI elements. */
  theme: Theme;
  /** Primary title (e.g. the routine name). */
  title: string;
  /** Optional subtitle (e.g. iteration counter). */
  subtitle?: string;
  /** Pre-formatted display rows (agent rows, status messages). */
  rows: string[];
  /** Optional metadata lines (continueWhile, notes). */
  metadata?: string[];
  /** Optional workspace path line. */
  path?: string;
}

/**
 * Build an array of lines for the TUI widget panel.
 *
 * Produces the "forge-run" widget content: a header with an accent
 * routine icon, a separator, the pre-formatted rows, and optional
 * metadata / workspace lines.
 */
export function buildWidgetLines(params: BuildWidgetLinesParams): string[] {
  const { theme, title, subtitle, rows, metadata, path } = params;
  const lines: string[] = [];

  // Header
  const header = subtitle
    ? `${theme.fg("accent", "⟳")} ${title} ${theme.fg("muted", subtitle)}`
    : `${theme.fg("accent", "⟳")} ${title}`;
  lines.push(header);

  // Separator
  const separatorWidth = Math.min(60, Math.max(title.length + (subtitle?.length ?? 0) + 8, 20));
  lines.push(theme.fg("muted", "─".repeat(separatorWidth)));

  // Rows
  if (rows.length > 0) {
    for (const row of rows) {
      lines.push(row);
    }
  } else {
    lines.push(`  ${theme.fg("muted", "no agents yet")}`);
  }

  // Metadata
  if (metadata && metadata.length > 0) {
    lines.push("");
    for (const meta of metadata) {
      lines.push(theme.fg("muted", `  ${meta}`));
    }
  }

  // Workspace path
  if (path) {
    lines.push(theme.fg("muted", `  ws: ${path}`));
  }

  return lines;
}

/**
 * Parameters for {@link buildStatusLine}.
 */
export interface BuildStatusLineParams {
  /** Theme for colouring UI elements. */
  theme: Theme;
  /** Primary title (e.g. the routine name). */
  title: string;
  /** Optional subtitle (e.g. "2/3"). */
  subtitle?: string;
  /** Pre-formatted tags to append (e.g. agent status chips). */
  tags: string[];
}

/**
 * Build a single-line status text for the TUI status bar.
 *
 * Produces the "feature-forge" status: an accent icon, the title,
 * optional subtitle, and agent tags joined with a middle-dot separator.
 */
export function buildStatusLine(params: BuildStatusLineParams): string {
  const { theme, title, subtitle, tags } = params;

  const iter = subtitle ? ` ${subtitle}` : "";
  const tagText = tags.length > 0 ? ` · ${tags.join(" · ")}` : "";
  return `${theme.fg("accent", "⟳")} ${title}${iter}${tagText}`;
}

/**
 * Format a single agent row for the widget panel.
 *
 * @param icon — Theme-coloured status icon.
 * @param label — Agent display label (typically the instruction id).
 * @param annotation — Optional summary text to append after an em-dash.
 */
export function formatAgentRow(icon: string, label: string, annotation?: string): string {
  const suffix = annotation ? ` — ${annotation}` : "";
  return `  ${icon} ${label}${suffix}`;
}
