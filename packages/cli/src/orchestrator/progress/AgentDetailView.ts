import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { MarkdownTheme, TUI } from "@earendil-works/pi-tui";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

import type { ToolRegistry } from "../../registry/ToolRegistry";
import { AgentDisplayHelpers } from "./AgentDisplayHelpers";
import { AgentViewerBase } from "./AgentViewerBase";
import { AgentViewerState } from "./AgentViewerState";
import { BorderedContainer, StaticContent } from "./BorderedContainer";
import { ConversationRenderer } from "./ConversationRenderer";
import { ScrollableBox } from "./ScrollableBox";

/**
 * Renders detailed view of a single agent's conversation and logs.
 */
export class AgentDetailView {
  /** Scroll offset for detail view content. */
  get scrollOffset(): number {
    return this._scrollOffset;
  }
  set scrollOffset(v: number) {
    this._scrollOffset = v;
  }

  /**
   * Whether the detail view automatically scrolls to the bottom when new
   * stream events arrive.
   */
  get autoScroll(): boolean {
    return this._autoScroll;
  }
  set autoScroll(v: boolean) {
    this._autoScroll = v;
  }

  /** Agent id currently being displayed. */
  selectedAgentId?: string;

  private _scrollOffset = 0;
  private _autoScroll = false;

  private readonly state: AgentViewerState;
  private readonly theme: Theme;
  private readonly tui: TUI;
  private readonly markdownTheme: MarkdownTheme;
  private readonly cwd: string;
  private readonly conversationRenderer: ConversationRenderer;

  /** ScrollableBox configuration derived from OVERLAY_OPTIONS. */
  private readonly scrollMaxHeightPercent = 0.85;
  private readonly scrollBorderOverhead = AgentViewerBase.BORDER_HEIGHT_OVERHEAD;

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
    } else {
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
    }

    // Wrap lines, then delegate viewport clipping + border to ScrollableBox and BorderedContainer.
    const allWrapped = lines.flatMap((line) => wrapTextWithAnsi(line, contentW));

    const scrollBox = new ScrollableBox(
      this.tui,
      this.scrollMaxHeightPercent,
      this.scrollBorderOverhead,
    );
    scrollBox.scrollOffset = this._scrollOffset;
    scrollBox.autoScroll = this._autoScroll;
    scrollBox.setCurrentAgent(this.selectedAgentId);
    scrollBox.addChild(new StaticContent(allWrapped));

    const borderedBox = new BorderedContainer(theme, undefined, 1, "warning");
    borderedBox.addChild(scrollBox);

    const result = borderedBox.render(width);

    // Sync scroll state back from the ScrollableBox (it may have clamped or re-enabled autoScroll).
    this._scrollOffset = scrollBox.scrollOffset;
    this._autoScroll = scrollBox.autoScroll;

    return result;
  }

  handleInput(data: string): void {
    // Delegate to a ScrollableBox instance so all key-handling
    // (including page up/down, home/end) is consistent.
    const scrollBox = new ScrollableBox(
      this.tui,
      this.scrollMaxHeightPercent,
      this.scrollBorderOverhead,
    );
    scrollBox.scrollOffset = this._scrollOffset;
    scrollBox.autoScroll = this._autoScroll;
    scrollBox.setCurrentAgent(this.selectedAgentId);
    scrollBox.handleInput(data);
    this._scrollOffset = scrollBox.scrollOffset;
    this._autoScroll = scrollBox.autoScroll;
  }

  /**
   * Auto-scroll to bottom when new events arrive for the displayed agent.
   *
   * Delegates to {@link ScrollableBox.onStreamEvent} which handles
   * autoScroll flag, agent-scoping, and viewport clamping.
   */
  onStreamEvent(agentId: string): void {
    const scrollBox = new ScrollableBox(
      this.tui,
      this.scrollMaxHeightPercent,
      this.scrollBorderOverhead,
    );
    scrollBox.scrollOffset = this._scrollOffset;
    scrollBox.autoScroll = this._autoScroll;
    scrollBox.setCurrentAgent(this.selectedAgentId);
    scrollBox.onStreamEvent(agentId);
    this._scrollOffset = scrollBox.scrollOffset;
    this._autoScroll = scrollBox.autoScroll;
  }

  // ── Private rendering ─────────────────────────────────────

  private renderConversationTurns(messages: AgentMessage[], width: number): string[] {
    return this.conversationRenderer.render(messages, AgentViewerBase.contentWidth(width));
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
