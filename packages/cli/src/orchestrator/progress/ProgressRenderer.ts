import {
  type AgentToolResult,
  DynamicBorder,
  type Theme,
  type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { ProgressWidget } from "@feature-forge/tui";
import { AgentDisplayHelpers } from "@feature-forge/tui";

import type { RoutineResult } from "../RoutineResult";
import { createAccumulatedState } from "./AccumulatedState";
import type { DisplayContributionRegistry } from "./DisplayContributionRegistry";
import type { RoutineProgressState } from "./RoutineProgressState";

// ── Theme-like contract (looser than pi's Theme) ────────────

// ── Parameter interfaces (exported, backwards-compatible) ────

/** Parameters for {@link ProgressRenderer.buildWidgetLines}. */
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

/** Parameters for {@link ProgressRenderer.buildStatusLine}. */
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

// ── Class ────────────────────────────────────────────────────

/**
 * Renders routine progress into TUI components and widget surfaces.
 *
 * **Static methods** are pure formatting helpers — call them with explicit
 * parameters (used in tests / external consumers).
 *
 * **Instance methods** read live progress from a {@link RoutineProgressState}
 * — use when you have a stateful routine (e.g. {@link RoutineTool}).
 */
export class ProgressRenderer {
  // ── Static helpers (pure, stateless) ──────────────────────

  /**
   * Map an agent status to a theme-coloured icon character.
   *
   * - `"done"` + passed → success green ✓
   * - `"done"` + !passed → error red ✗
   * - `"running"` → accent ⟳
   * - `"started"` → warning yellow →
   * - `"error"` → error red ✗
   * - anything else → muted grey ○
   */
  static statusIcon(status: string | undefined, theme: Theme, passed?: boolean): string {
    const { char, color } = AgentDisplayHelpers.getStatusIcon(status, passed);
    return theme.fg(color, char);
  }

  /**
   * Format a single agent row for the widget panel.
   *
   * @param icon — Theme-coloured status icon.
   * @param label — Agent display label (typically the instruction id).
   * @param annotation — Optional summary text to append after an em-dash.
   */
  static formatAgentRow(icon: string, label: string, annotation?: string): string {
    const suffix = annotation ? ` — ${annotation}` : "";
    return `  ${icon} ${label}${suffix}`;
  }

  /**
   * Build an array of lines for the TUI widget panel.
   *
   * Produces the "forge-run" widget content: a header with an accent
   * routine icon, a separator, the pre-formatted rows, and optional
   * metadata / workspace lines.
   */
  static buildWidgetLines(params: BuildWidgetLinesParams): string[] {
    const { theme, title, subtitle, rows, metadata, path } = params;
    const lines: string[] = [];

    // Header
    const runningIcon = ProgressRenderer.statusIcon("running", theme);
    const header = subtitle
      ? `${runningIcon} ${title} ${theme.fg("muted", subtitle)}`
      : `${runningIcon} ${title}`;
    lines.push(header);

    // Separator
    const separatorWidth = Math.max(
      0,
      visibleWidth(title) + (subtitle ? visibleWidth(subtitle) : 0),
    );
    lines.push(...new DynamicBorder((str) => theme.fg("muted", str)).render(separatorWidth));

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
   * Build a single-line status text for the TUI status bar.
   *
   * Produces the "feature-forge" status: an accent icon, the title,
   * optional subtitle, and agent tags joined with a middle-dot separator.
   */
  static buildStatusLine(params: BuildStatusLineParams): string {
    const { theme, title, subtitle, tags } = params;

    const runningIcon = ProgressRenderer.statusIcon("running", theme);
    const iter = subtitle ? ` ${subtitle}` : "";
    const tagText = tags.length > 0 ? ` · ${tags.join(" · ")}` : "";
    return `${runningIcon} ${title}${iter}${tagText}`;
  }

  /**
   * Build a human-readable result suffix from routine result details.
   *
   * Priority (highest first):
   * 1. Agent label or id — identifies which agent produced the result.
   * 2. Rounds count — shows how many loop iterations the routine ran.
   * 3. PR URL — extracted from the `pr` instruction raw output (e.g. `gh pr create` result).
   * 4. Workspace path — shows the worktree location.
   * 5. Cleanup summary — extracted from the `cleanup` instruction parsed output.
   * 6. Summary text — the routine's own digest message.
   * 7. Fallback — "passed" / "failed" based on {@link RoutineResult.passed}.
   *
   * @param details — The routine result details (may be undefined).
   * @returns A short human-readable suffix string.
   */
  static buildResultSuffix(details: RoutineResult | undefined): string {
    if (!details) {
      return "failed";
    }

    if (details.label) {
      return `agent: ${details.label}`;
    }

    if (details.agentId) {
      return `agent: ${details.agentId}`;
    }

    if (typeof details.rounds === "number" && details.rounds > 0) {
      return `${details.rounds} round${details.rounds > 1 ? "s" : ""}`;
    }

    if (details.results.pr?.raw) {
      const raw = details.results.pr.raw;
      // Extract just the GitHub PR URL — raw may contain multi-line stderr
      const prUrlMatch = raw.match(/https?:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/);
      if (prUrlMatch) {
        return prUrlMatch[0];
      }
      // Fall back to first non-empty line only — never emit multi-line raw output
      const firstLine = raw.split("\n").find((l: string) => l.trim()) ?? raw;
      return firstLine;
    }

    if (details.workspace) {
      const base = details.workspace.split("/").pop() ?? details.workspace;
      return `ws: ${base}`;
    }

    if (details.results.cleanup?.parsed?.summary) {
      return details.results.cleanup.parsed.summary;
    }

    if (details.summary) {
      return details.summary;
    }

    return details.passed ? "passed" : "failed";
  }

  // ── Instance (reads live state) ────────────────────────────

  private readonly state: RoutineProgressState;
  private readonly registry: DisplayContributionRegistry;

  /**
   * @param state — Live progress state (typically the {@link RoutineTool} itself).
   * @param registry — Registry of handlers that apply contributions to an
   *   {@link AccumulatedState}. Step executors register their handlers via
   *   {@link registerDisplayHandler} when the registry is wired up.
   */
  constructor(state: RoutineProgressState, registry: DisplayContributionRegistry) {
    this.state = state;
    this.registry = registry;
  }

  /**
   * Build a {@link Component} for the tool-row "call" line.
   *
   * Shows an accent spinner, the routine name, iteration counter (when
   * the routine has a loop), and an agent count (or "pending").
   */
  buildCallComponent(theme: Theme): Component {
    const state = this.state;
    return {
      render: (width: number) => {
        const acc = createAccumulatedState();
        this.registry.apply(acc, state.contributions);
        const runningIcon = ProgressRenderer.statusIcon("running", theme);
        const parts = [`${runningIcon} ${state.routineName}`];
        if (acc.maxIterations > 0) {
          parts.push(theme.fg("muted", ` ${acc.iteration + 1}/${acc.maxIterations}`));
        }
        const agentCount = acc.agentMap.size;
        if (agentCount > 0) {
          parts.push(theme.fg("muted", ` · ${agentCount} agent${agentCount > 1 ? "s" : ""}`));
        } else {
          parts.push(theme.fg("muted", " · pending"));
        }
        const line = parts.join("");
        return [truncateToWidth(line, width, "", true)];
      },
      invalidate: () => {
        /* stateless — re-render is handled by onStateChange */
      },
    };
  }

  /**
   * Build a {@link Component} for the tool-row "result" line.
   *
   * Partial (streaming) updates show a neutral "running" state.
   * Final results show ✓/✗ with a contextual suffix from
   * {@link buildResultSuffix}.
   */
  buildResultComponent(
    result: AgentToolResult<RoutineResult>,
    options: ToolRenderResultOptions,
    theme: Theme,
  ): Component {
    const routine = result.details?.routine ?? this.state.routineName;

    if (options.isPartial) {
      return {
        render: () => [`${ProgressRenderer.statusIcon("started", theme)} ${routine} · running`],
        invalidate: () => {},
      };
    }

    const passed = result.details?.passed ?? false;
    const icon = ProgressRenderer.statusIcon("done", theme, passed);
    const acc = createAccumulatedState();
    this.registry.apply(acc, this.state.contributions);
    const suffix = acc.resultSnippet ?? ProgressRenderer.buildResultSuffix(result.details);

    return {
      render: (width: number) => {
        const line = `${icon} ${routine} · ${suffix}`;
        return wrapTextWithAnsi(line, width);
      },
      invalidate: () => {
        /* stateless — nothing to clear */
      },
    };
  }

  /**
   * Sync accumulated progress state to a {@link ProgressWidget}.
   *
   * Builds widget lines and status text from the current state, then
   * calls `widget.render()`.
   */
  renderToWidget(widget: ProgressWidget, theme: Theme): void {
    const { state } = this;

    const acc = createAccumulatedState();
    this.registry.apply(acc, state.contributions);

    const rows: string[] = [];
    for (const [label, agent] of acc.agentMap) {
      const icon = ProgressRenderer.statusIcon(agent.status, theme, agent.passed);
      rows.push(ProgressRenderer.formatAgentRow(icon, label, agent.summary));
    }

    const subtitle =
      acc.maxIterations > 0 ? `iteration ${acc.iteration + 1}/${acc.maxIterations}` : undefined;

    const metadata: string[] = [];
    if (acc.continueWhile) {
      metadata.push(`while: ${acc.continueWhile}`);
    }

    const pathLine = [acc.workspace, acc.branch].filter(Boolean).join(" · ");

    const widgetLines = ProgressRenderer.buildWidgetLines({
      theme,
      title: state.routineName,
      subtitle,
      rows,
      metadata: metadata.length > 0 ? metadata : undefined,
      path: pathLine || undefined,
    });

    const tags: string[] = [];
    for (const [label, agent] of acc.agentMap) {
      tags.push(`${ProgressRenderer.statusIcon(agent.status, theme, agent.passed)} ${label}`);
    }

    const statusText = ProgressRenderer.buildStatusLine({
      theme,
      title: state.routineName,
      subtitle: acc.maxIterations > 0 ? `${acc.iteration + 1}/${acc.maxIterations}` : undefined,
      tags,
    });

    widget.render(widgetLines, statusText);
  }
}
