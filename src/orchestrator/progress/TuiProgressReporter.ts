import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

import type { ProgressWidget } from "./ProgressReporter";

/**
 * TUI implementation of {@link ProgressWidget} that drives two surfaces:
 *
 * 1. **Widget** ("forge-run", aboveEditor) — multi-line progress panel
 * 2. **Status** ("feature-forge") — single-line footer status
 *
 * Widget renders are throttled to ~4/s (250ms minimum interval) to avoid
 * thrashing the TUI when calls arrive in rapid succession. Status updates
 * are immediate.
 *
 * The class is domain-agnostic — it accepts pre-formatted widget lines
 * and status text. All formatting and state accumulation happens in the
 * caller (typically {@link import("../RoutineTool").RoutineTool}).
 */
export class TuiRoutineWidget implements ProgressWidget {
  private readonly ctx: ExtensionContext;
  private readonly onStateChange?: () => void;

  private lastRenderTimestamp = 0;
  private throttleTimer: ReturnType<typeof setTimeout> | undefined;

  /** Cached lines from the last render call so the render closure stays stateless. */
  private cachedLines: string[] = [];

  constructor(params: { ctx: ExtensionContext; onStateChange?: () => void }) {
    this.ctx = params.ctx;
    this.onStateChange = params.onStateChange;
  }

  /**
   * Render widget lines and status text to the TUI surfaces.
   *
   * Status updates are immediate. Widget updates are throttled to 250ms.
   */
  render(widgetLines: string[], statusText: string): void {
    this.ctx.ui.setStatus("feature-forge", statusText);
    this.cachedLines = widgetLines;
    this.throttledWidgetRender();

    if (this.onStateChange) {
      this.onStateChange();
    }
  }

  /** Remove the widget and status from both surfaces. */
  clear(): void {
    if (this.throttleTimer !== undefined) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = undefined;
    }
    this.ctx.ui.setWidget("forge-run", undefined);
    this.ctx.ui.setStatus("feature-forge", undefined);
  }

  // ── Private rendering ──────────────────────────────────────

  private throttledWidgetRender(): void {
    const now = Date.now();
    const minInterval = 250;

    if (now - this.lastRenderTimestamp >= minInterval) {
      this.lastRenderTimestamp = now;
      this.renderWidget();
      return;
    }

    if (this.throttleTimer === undefined) {
      this.throttleTimer = setTimeout(() => {
        this.throttleTimer = undefined;
        this.lastRenderTimestamp = Date.now();
        this.renderWidget();
      }, minInterval);
    }
  }

  private renderWidget(): void {
    const lines = this.cachedLines;

    const renderFn = (_tui: TUI, _renderTheme: Theme): Component => ({
      render: (_width: number) => lines,
      invalidate: () => {
        /* stateless — re-render is handled by throttled update */
      },
    });

    this.ctx.ui.setWidget("forge-run", renderFn, { placement: "aboveEditor" });
  }
}
