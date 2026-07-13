import type {
  AgentToolResult,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";

import type { RoutineResult } from "../RoutineResult";
import { AgentDisplayHelpers } from "./AgentDisplayHelpers";
import type { DisplayContribution } from "./DisplayContribution";
import type { ProgressWidget } from "./ProgressReporter";
import type { RoutineProgressState } from "./RoutineProgressState";

// ── Theme-like contract (looser than pi's Theme) ────────────

/** Minimal colouring contract shared by pi's Theme and no-op fallbacks. */
export interface ThemeLike {
  fg(color: string, text: string): string;
}

// ── Parameter interfaces (exported, backwards-compatible) ────

/** Parameters for {@link ProgressRenderer.buildWidgetLines}. */
export interface BuildWidgetLinesParams {
  /** Theme for colouring UI elements. */
  theme: ThemeLike;
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
  theme: ThemeLike;
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
   * - `"started"` → warning yellow ⏳
   * - `"error"` → error red ✗
   * - anything else → muted grey ○
   */
  static statusIcon(status: string | undefined, theme: ThemeLike, passed?: boolean): string {
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
   * Build a {@link Map} of agent id → {status, summary, passed} from accumulated contributions.
   *
   * Later contributions for the same agent id overwrite earlier ones,
   * so the map always reflects the most recent status for each agent.
   */
  static buildAgentMap(
    contributions: readonly DisplayContribution[],
  ): Map<string, { status: string; summary?: string; passed?: boolean }> {
    const map = new Map<string, { status: string; summary?: string; passed?: boolean }>();
    for (const c of contributions) {
      if (c.agentId && c.agentStatus) {
        map.set(c.agentId, {
          status: c.agentStatus,
          summary: c.agentSummary,
          passed: c.agentPassed,
        });
      }
    }
    return map;
  }

  /**
   * Extract the latest iteration info from accumulated contributions.
   *
   * Returns `{ iteration: 0, maxIterations: 0 }` when no loop contributions
   * have been accumulated yet.
   */
  static getIterationInfo(contributions: readonly DisplayContribution[]): {
    iteration: number;
    maxIterations: number;
  } {
    let iteration = 0;
    let maxIterations = 0;
    for (const c of contributions) {
      if (c.iteration !== undefined) iteration = c.iteration;
      if (c.maxIterations !== undefined) maxIterations = c.maxIterations;
    }
    return { iteration, maxIterations };
  }

  /**
   * Extract the latest workspace path from accumulated contributions.
   */
  static getWorkspacePath(contributions: readonly DisplayContribution[]): string | undefined {
    let workspace: string | undefined;
    for (const c of contributions) {
      if (c.workspace !== undefined) workspace = c.workspace;
    }
    return workspace;
  }

  /**
   * Extract the latest branch name from accumulated contributions.
   */
  static getBranch(contributions: readonly DisplayContribution[]): string | undefined {
    let branch: string | undefined;
    for (const c of contributions) {
      if (c.branch !== undefined) branch = c.branch;
    }
    return branch;
  }

  /**
   * Extract the latest continueWhile expression from accumulated contributions.
   */
  static getContinueWhile(contributions: readonly DisplayContribution[]): string | undefined {
    let continueWhile: string | undefined;
    for (const c of contributions) {
      if (c.continueWhile !== undefined) continueWhile = c.continueWhile;
    }
    return continueWhile;
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
      return details.results.pr.raw;
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

  /**
   * @param state — Live progress state (typically the {@link RoutineTool} itself).
   */
  constructor(state: RoutineProgressState) {
    this.state = state;
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
      render: () => {
        const agentMap = ProgressRenderer.buildAgentMap(state.contributions);
        const { iteration, maxIterations } = ProgressRenderer.getIterationInfo(state.contributions);
        const runningIcon = ProgressRenderer.statusIcon("running", theme);
        const parts = [`${runningIcon} ${state.routineName}`];
        if (maxIterations > 0) {
          parts.push(theme.fg("muted", ` ${iteration + 1}/${maxIterations}`));
        }
        const agentCount = agentMap.size;
        if (agentCount > 0) {
          parts.push(theme.fg("muted", ` · ${agentCount} agent${agentCount > 1 ? "s" : ""}`));
        } else {
          parts.push(theme.fg("muted", " · pending"));
        }
        return [parts.join("")];
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
    const suffix = ProgressRenderer.buildResultSuffix(result.details);

    return {
      render: () => [`${icon} ${routine} · ${suffix}`],
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
  renderToWidget(widget: ProgressWidget, theme: ThemeLike): void {
    const { state } = this;

    const agentMap = ProgressRenderer.buildAgentMap(state.contributions);
    const { iteration, maxIterations } = ProgressRenderer.getIterationInfo(state.contributions);
    const workspace = ProgressRenderer.getWorkspacePath(state.contributions);
    const branch = ProgressRenderer.getBranch(state.contributions);
    const continueWhile = ProgressRenderer.getContinueWhile(state.contributions);

    const rows: string[] = [];
    for (const [label, agent] of agentMap) {
      const icon = ProgressRenderer.statusIcon(agent.status, theme, agent.passed);
      rows.push(ProgressRenderer.formatAgentRow(icon, label, agent.summary));
    }

    const subtitle = maxIterations > 0 ? `iteration ${iteration + 1}/${maxIterations}` : undefined;

    const metadata: string[] = [];
    if (continueWhile) {
      metadata.push(`while: ${continueWhile}`);
    }

    const pathLine = [workspace, branch].filter(Boolean).join(" · ");

    const widgetLines = ProgressRenderer.buildWidgetLines({
      theme,
      title: state.routineName,
      subtitle,
      rows,
      metadata: metadata.length > 0 ? metadata : undefined,
      path: pathLine || undefined,
    });

    const tags: string[] = [];
    for (const [label, agent] of agentMap) {
      tags.push(`${ProgressRenderer.statusIcon(agent.status, theme, agent.passed)} ${label}`);
    }

    const statusText = ProgressRenderer.buildStatusLine({
      theme,
      title: state.routineName,
      subtitle: maxIterations > 0 ? `${iteration + 1}/${maxIterations}` : undefined,
      tags,
    });

    widget.render(widgetLines, statusText);
  }
}
