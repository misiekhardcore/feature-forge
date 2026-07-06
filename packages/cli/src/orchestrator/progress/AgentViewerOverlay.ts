import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

/**
 * Per-agent view entry managed by {@link AgentViewerOverlay}.
 *
 * Updated in place as agent lifecycle events arrive from the executor.
 */
export interface AgentViewerEntry {
  /** Agent instruction id (e.g. "builder", "reviewer"). */
  id: string;
  /** Lifecycle status: "started" | "done" | "error". */
  status: string;
  /** Optional one-line summary from a completed agent step. */
  summary?: string;
  /** Optional raw output from the agent (truncated for display). */
  raw?: string;
}

/**
 * TUI component that renders agent execution details in an overlay widget.
 *
 * Designed to be rendered via {@code ctx.ui.setWidget} or
 * {@code ctx.ui.custom} as a persistent panel showing live agent status.
 *
 * The owning tool (typically {@link import("../RoutineTool").RoutineTool})
 * calls {@link update} as agent events arrive and {@link clear} when the
 * routine finishes.
 */
export class AgentViewerOverlay {
  private agents = new Map<string, AgentViewerEntry>();

  /** Max characters of raw agent output to display per entry. */
  private readonly maxRawLength: number;

  /**
   * @param maxRawLength — Truncation limit for raw agent output (default 500).
   */
  constructor(maxRawLength = 500) {
    this.maxRawLength = maxRawLength;
  }

  /**
   * Push or update a single agent entry.
   *
   * Later calls for the same agent id merge with and overwrite prior state
   * so the overlay always reflects the most recent lifecycle status.
   */
  update(entry: AgentViewerEntry): void {
    const existing = this.agents.get(entry.id);
    this.agents.set(entry.id, { ...existing, ...entry });
  }

  /** Remove all agent entries. */
  clear(): void {
    this.agents.clear();
  }

  /** Number of agent entries currently tracked. */
  get entryCount(): number {
    return this.agents.size;
  }

  /**
   * Build a {@link Component} factory suitable for
   * {@code ctx.ui.setWidget(key, factory)}.
   *
   * Returns a function `(tui, theme) => Component` that the TUI calls.
   * The returned Component reads live agent state from this overlay instance
   * so callers can re-render by calling {@code ctx.ui.setWidget} again.
   */
  buildWidgetFactory(): (_tui: TUI, theme: Theme) => Component {
    return (_tui: TUI, theme: Theme): Component => ({
      render: (width: number) => this.renderLines(width, theme),
      invalidate: () => {
        /* stateless — re-render is handled by setWidget calls */
      },
    });
  }

  // ── Private rendering ────────────────────────────────────

  private renderLines(width: number, theme: Theme): string[] {
    const lines: string[] = [];

    // Header
    lines.push(theme.fg("accent", "⟳ Agent Viewer"));
    const separatorWidth = Math.min(width, 60);
    lines.push(theme.fg("muted", "─".repeat(separatorWidth)));

    if (this.agents.size === 0) {
      lines.push(`  ${theme.fg("muted", "no agents running")}`);
      return lines.flatMap((line) => wrapTextWithAnsi(line, width));
    }

    for (const [id, entry] of this.agents) {
      const icon = AgentViewerOverlay.statusIcon(entry.status);
      const statusLabel = `[${entry.status}]`;
      lines.push(`  ${icon} ${id} ${theme.fg("muted", statusLabel)}`);

      if (entry.summary) {
        lines.push(`    ${theme.fg("muted", entry.summary)}`);
      }

      if (entry.raw !== undefined) {
        const truncated =
          entry.raw.length > this.maxRawLength
            ? entry.raw.slice(0, this.maxRawLength) + "..."
            : entry.raw;
        for (const rawLine of truncated.split("\n")) {
          lines.push(`      ${theme.fg("muted", rawLine)}`);
        }
      }
    }

    return lines.flatMap((line) => wrapTextWithAnsi(line, width));
  }

  /**
   * Map an agent status to a theme-coloured icon character.
   *
   * - `"done"` → success green ✓
   * - `"started"` → warning yellow ⏳
   * - `"error"` → error red ✗
   * - anything else → muted grey ○
   */
  static statusIcon(status: string): string {
    switch (status) {
      case "done":
        return "✓";
      case "started":
        return "⏳";
      case "error":
        return "✗";
      default:
        return "○";
    }
  }
}
