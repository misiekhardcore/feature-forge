import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { MarkdownTheme, TUI } from "@earendil-works/pi-tui";
import { Key, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import type { ToolRegistry } from "../../registry/ToolRegistry";
import { AgentDisplayHelpers } from "./AgentDisplayHelpers";
import { AgentViewerBase } from "./AgentViewerBase";
import { AgentViewerState } from "./AgentViewerState";
import { ConversationRenderer } from "./ConversationRenderer";

/**
 * Standard overlay configuration — mirrors
 * {@link AgentViewerOverlay.overlayOptions}.
 */
const OVERLAY_OPTIONS = {
  anchor: "center" as const,
  width: "100%" as const,
  maxHeight: "85%" as const,
  margin: 1,
};

/**
 * Renders detailed view of a single agent's conversation and logs.
 */
export class AgentDetailView {
  /** Scroll offset for detail view content. */
  scrollOffset = 0;

  /**
   * Whether the detail view automatically scrolls to the bottom when new
   * stream events arrive.
   */
  autoScroll = false;

  /** Agent id currently being displayed. */
  selectedAgentId?: string;

  private readonly state: AgentViewerState;
  private readonly theme: Theme;
  private readonly tui: TUI;
  private readonly markdownTheme: MarkdownTheme;
  private readonly cwd: string;
  private readonly conversationRenderer: ConversationRenderer;

  /** Last render width used to compute scroll bounds. */
  private lastRenderWidth = 80;

  /**
   * Cached total wrapped line count from the most recent render.
   * Used to clamp scroll offset and detect bottom-of-content.
   */
  private cachedWrappedLineCount = 0;

  constructor(
    state: AgentViewerState,
    theme: Theme,
    markdownTheme: MarkdownTheme,
    tui: TUI,
    cwd: string,
    toolRegistry: ToolRegistry,
  ) {
    this.state = state;
    this.theme = theme;
    this.markdownTheme = markdownTheme;
    this.tui = tui;
    this.cwd = cwd;
    this.conversationRenderer = new ConversationRenderer({
      theme,
      markdownTheme,
      tui,
      cwd,
      toolRegistry,
    });
  }

  /**
   * Signal that new content has arrived.
   *
   * The dirty signal is consumed by {@link onStreamEvent} to trigger
   * auto-scroll when enabled. The actual line-count cache is rebuilt
   * during the next {@link render} call.
   */
  markDirty(): void {
    // No-op: dirty tracking is handled via render() re-computation.
  }

  render(width: number): string[] {
    this.lastRenderWidth = width;
    const { theme } = this;
    const contentW = AgentViewerBase.contentWidth(width);
    const lines: string[] = [];

    const entry = this.selectedAgentId ? this.state.getAgentEntry(this.selectedAgentId) : undefined;
    if (!entry) {
      lines.push(theme.fg("accent", "Agent Detail"));
      lines.push(theme.fg("muted", AgentDisplayHelpers.getHorizontalLine(contentW)));
      lines.push(theme.fg("muted", "agent not found"));
      lines.push("");
      lines.push(theme.fg("muted", `${theme.fg("accent", "Esc")} back`));
      const allWrapped = lines.flatMap((line) => wrapTextWithAnsi(line, contentW));
      this.cachedWrappedLineCount = allWrapped.length;

      const viewportHeight = this.computeViewportHeight();
      const maxOffset = Math.max(0, this.cachedWrappedLineCount - viewportHeight);
      if (this.scrollOffset >= maxOffset) {
        this.autoScroll = true;
      }
      this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxOffset));
      const viewportEnd = Math.min(this.scrollOffset + viewportHeight, allWrapped.length);
      return AgentViewerBase.addBorder(
        allWrapped.slice(this.scrollOffset, viewportEnd),
        width,
        theme,
      );
    }

    const { char: icon, color: iconColor } = AgentDisplayHelpers.getStatusIcon(
      entry.status,
      entry.passed,
    );
    const { label, color: statusColor } = AgentDisplayHelpers.getStatusLabel(
      entry.status,
      entry.passed,
    );

    // Header
    lines.push(
      `${theme.fg(iconColor, icon)} ${theme.fg("accent", entry.id)} — ${theme.fg(statusColor, label)}`,
    );
    lines.push(theme.fg("muted", AgentDisplayHelpers.getHorizontalLine(contentW)));

    // Summary
    if (entry.summary) {
      lines.push(theme.fg("accent", "Summary:"));
      lines.push("");
      lines.push(entry.summary);
      lines.push("");
    }

    // Conversation header
    lines.push(theme.fg("accent", "Conversation:"));
    lines.push("");

    const messages = this.state.getConversationMessages(entry.id);
    const conversationLines = this.renderConversationTurns(messages, width);
    if (conversationLines.length === 0) {
      lines.push(theme.fg("muted", "No conversation recorded."));
      lines.push("");
    } else {
      for (const convLine of conversationLines) {
        lines.push(convLine);
      }
      lines.push("");
    }

    // Help text
    lines.push(
      theme.fg("muted", `${theme.fg("accent", "Esc")} back  ${theme.fg("accent", "↑↓")} scroll`),
    );

    // Wrap all content lines first, then compute viewport from the actual wrapped count.
    const allWrapped = lines.flatMap((line) => wrapTextWithAnsi(line, contentW));
    this.cachedWrappedLineCount = allWrapped.length;

    const viewportHeight = this.computeViewportHeight();
    const maxOffset = Math.max(0, this.cachedWrappedLineCount - viewportHeight);
    if (this.scrollOffset >= maxOffset) {
      this.autoScroll = true;
    }
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxOffset));
    const viewportEnd = Math.min(this.scrollOffset + viewportHeight, allWrapped.length);

    return AgentViewerBase.addBorder(
      allWrapped.slice(this.scrollOffset, viewportEnd),
      width,
      theme,
    );
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.up)) {
      this.autoScroll = false;
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      this.tui.requestRender();
    } else if (matchesKey(data, Key.down)) {
      this.scrollOffset = this.scrollOffset + 1;
      this.tui.requestRender();
    }
  }

  /**
   * Auto-scroll to bottom when new events arrive for the displayed agent.
   *
   * Sets scrollOffset to a large value when autoScroll is enabled;
   * the next {@link render} call clamps it to the actual maximum.
   */
  onStreamEvent(agentId: string): void {
    if (this.autoScroll && this.selectedAgentId === agentId) {
      this.scrollOffset = Number.MAX_SAFE_INTEGER;
    }
  }

  // ── Private rendering ─────────────────────────────────────

  private renderConversationTurns(messages: AgentMessage[], width: number): string[] {
    return this.conversationRenderer.render(messages, AgentViewerBase.contentWidth(width));
  }

  private computeViewportHeight(): number {
    const termHeight = this.tui?.terminal?.rows;
    if (!termHeight || termHeight < 1) return 15;
    // TUI's parseSizeValue uses Math.floor for percentage → match it so
    // viewport + border exactly equals maxHeight (avoids clipping border).
    const rawMaxHeight = Math.floor(
      (Number(OVERLAY_OPTIONS.maxHeight.slice(0, -1)) / 100) * termHeight,
    );
    const maxHeight = Math.max(1, rawMaxHeight);
    return Math.max(1, maxHeight - AgentViewerBase.BORDER_HEIGHT_OVERHEAD);
  }

  // ── Conversation loading (exposed for overlay) ────────────

  /**
   * Load conversation events from disk for the selected agent.
   */
  async loadConversationEvents(count?: number): Promise<AgentEvent[]> {
    if (!this.selectedAgentId) return [];
    return this.state.loadConversationEvents(this.selectedAgentId, count);
  }
}
