import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

import type { ProgressEvent } from "./ProgressEvent";
import { ProgressReporter, type ProgressSnapshot } from "./ProgressReporter";

/**
 * Parameters for constructing a {@link TuiProgressReporter}.
 */
export interface TuiProgressReporterParams {
  /** Extension context providing UI access and theme colors. */
  ctx: ExtensionContext;
  /** Name of the routine being reported on. */
  routineName: string;
  /** Maximum loop iterations (0 when the routine has no loop). */
  maxIterations: number;
  /** Loop continueWhile expression, if applicable. */
  continueWhile?: string;
  /** Called after each update so external consumers (e.g. RoutineTool) can invalidate their render. */
  onStateChange?: () => void;
}

/**
 * Parameters for building widget render lines.
 *
 * Extracted from {@link TuiProgressReporter} so the lines builder can be
 * tested independently from the TUI rendering pipeline.
 */
export interface WidgetLinesParams {
  theme: Theme;
  routineName: string;
  maxIterations: number;
  iteration: number;
  agents: Map<string, { status: string; summary?: string }>;
  continueWhile?: string;
  workspace?: string;
}

/**
 * TUI implementation of {@link ProgressReporter} that drives three surfaces:
 *
 * 1. **Widget** ("forge-run", aboveEditor) — multi-line progress panel
 * 2. **Status** ("feature-forge") — single-line footer status
 * 3. **onStateChange** callback — allows RoutineTool to re-render its tool-row
 *
 * Widget renders are throttled to ~4/s (250ms minimum interval) to avoid
 * thrashing the TUI when events arrive in rapid succession.
 *
 * ## Theme-aware icons
 *
 * - ✓ (success) — `theme.fg("success", "✓")`
 * - ⏳ (running) — `theme.fg("warning", "⏳")`
 * - ✗ (error) — `theme.fg("error", "✗")`
 * - ○ (idle) — `theme.fg("muted", "○")`
 * - ⟳ (routine) — `theme.fg("accent", "⟳")`
 */
export class TuiProgressReporter extends ProgressReporter {
  private readonly ctx: ExtensionContext;
  private readonly routineName: string;
  private readonly maxIterations: number;
  private readonly continueWhile?: string;
  private readonly onStateChange?: () => void;

  private iteration = 0;
  private phase = "";
  private message = "";
  private workspace?: string;
  private readonly agents = new Map<string, { status: string; summary?: string }>();

  private lastRenderTimestamp = 0;
  private throttleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(params: TuiProgressReporterParams) {
    super();
    this.ctx = params.ctx;
    this.routineName = params.routineName;
    this.maxIterations = params.maxIterations;
    this.continueWhile = params.continueWhile;
    this.onStateChange = params.onStateChange;
  }

  override update(event: ProgressEvent): void {
    this.iteration = event.iteration;
    this.phase = event.phase;
    this.message = event.message;

    if (event.workspace !== undefined) {
      this.workspace = event.workspace;
    }

    if (event.agentId !== undefined && event.agentStatus !== undefined) {
      this.agents.set(event.agentId, {
        status: event.agentStatus,
        summary: event.agentSummary,
      });
    }

    this.updateStatus();
    this.throttledWidgetRender();

    if (this.onStateChange) {
      this.onStateChange();
    }
  }

  override clear(): void {
    if (this.throttleTimer !== undefined) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = undefined;
    }
    this.ctx.ui.setWidget("forge-run", undefined);
    this.ctx.ui.setStatus("feature-forge", undefined);
  }

  override getState(): ProgressSnapshot {
    return {
      routineName: this.routineName,
      phase: this.phase,
      message: this.message,
      iteration: this.iteration,
      maxIterations: this.maxIterations,
      continueWhile: this.continueWhile,
      workspace: this.workspace,
      agents: new Map(this.agents),
    };
  }

  // ── Private rendering ──────────────────────────────────────

  private updateStatus(): void {
    const theme = this.ctx.ui.theme;
    const agentParts: string[] = [];
    for (const [agentId, agent] of this.agents) {
      const icon = this.statusIcon(agent.status, theme);
      agentParts.push(`${icon} ${agentId}`);
    }

    const iter = this.maxIterations > 0 ? ` ${this.iteration + 1}/${this.maxIterations}` : "";
    const line = `${theme.fg("accent", "⟳")} ${this.routineName}${iter}${agentParts.length > 0 ? ` · ${agentParts.join(" · ")}` : ""}`;
    this.ctx.ui.setStatus("feature-forge", line);
  }

  private throttledWidgetRender(): void {
    const now = Date.now();
    const minInterval = 250;

    if (now - this.lastRenderTimestamp >= minInterval) {
      this.lastRenderTimestamp = now;
      this.renderWidget();
      return;
    }

    // Schedule a deferred render if one isn't already pending
    if (this.throttleTimer === undefined) {
      this.throttleTimer = setTimeout(() => {
        this.throttleTimer = undefined;
        this.lastRenderTimestamp = Date.now();
        this.renderWidget();
      }, minInterval);
    }
  }

  /**
   * Build widget render lines from accumulated state.
   *
   * Extracted as a static method so it can be tested independently
   * from the TUI render pipeline.
   */
  static buildWidgetLines(params: WidgetLinesParams): string[] {
    const { theme, routineName, maxIterations, iteration, agents, continueWhile, workspace } =
      params;
    const lines: string[] = [];

    // Header
    const header =
      maxIterations > 0
        ? `${theme.fg("accent", "⟳")} ${routineName} ${theme.fg("muted", `iteration ${iteration + 1}/${maxIterations}`)}`
        : `${theme.fg("accent", "⟳")} ${routineName}`;
    lines.push(header);

    // Separator
    lines.push(theme.fg("muted", "─".repeat(Math.min(60, routineName.length + 20))));

    // Agent rows
    if (agents.size > 0) {
      for (const [agentId, agent] of agents) {
        const icon = statusIconStatic(agent.status, theme);
        const summary = agent.summary ? ` — ${agent.summary}` : "";
        lines.push(`  ${icon} ${agentId}${summary}`);
      }
    } else {
      lines.push(`  ${theme.fg("muted", "no agents yet")}`);
    }

    // ContinueWhile
    if (continueWhile) {
      lines.push("");
      lines.push(theme.fg("muted", `  while: ${continueWhile}`));
    }

    // Workspace
    if (workspace) {
      lines.push(theme.fg("muted", `  ws: ${workspace}`));
    }

    return lines;
  }

  private renderWidget(): void {
    const lines = TuiProgressReporter.buildWidgetLines({
      theme: this.ctx.ui.theme,
      routineName: this.routineName,
      maxIterations: this.maxIterations,
      iteration: this.iteration,
      agents: new Map(this.agents),
      continueWhile: this.continueWhile,
      workspace: this.workspace,
    });

    const renderFn = (_tui: TUI, _renderTheme: Theme): Component => ({
      render: (_width: number) => lines,
      invalidate: () => {
        /* stateless — re-render is handled by throttled update */
      },
    });

    this.ctx.ui.setWidget("forge-run", renderFn, { placement: "aboveEditor" });
  }

  private statusIcon(status: string, theme: Theme): string {
    return statusIconStatic(status, theme);
  }
}

/** Standalone version of statusIcon for use in the render closure. */
function statusIconStatic(status: string, theme: Theme): string {
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
