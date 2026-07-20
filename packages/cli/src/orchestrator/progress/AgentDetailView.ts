import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { DynamicBorder, type Theme } from "@earendil-works/pi-coding-agent";
import { type MarkdownTheme, Spacer, Text, type TUI } from "@earendil-works/pi-tui";

import type { ToolRegistry } from "../../registry/ToolRegistry";
import { AgentDisplayHelpers } from "./AgentDisplayHelpers";
import { AgentViewerState } from "./AgentViewerState";
import { BorderedContainer, StaticContent } from "./BorderedContainer";
import { ConversationRenderer } from "./ConversationRenderer";
import { ScrollableBox } from "./ScrollableBox";

/**
 * Renders detailed view of a single agent's conversation and logs.
 */
export class AgentDetailView {
  /** Scroll offset for detail view content — delegates to ScrollableBox. */
  get scrollOffset(): number {
    return this.scrollableBox.scrollOffset;
  }
  set scrollOffset(v: number) {
    this.scrollableBox.scrollOffset = v;
  }

  /**
   * Whether the detail view automatically scrolls to the bottom when new
   * stream events arrive — delegates to ScrollableBox.
   */
  get autoScroll(): boolean {
    return this.scrollableBox.autoScroll;
  }
  set autoScroll(v: boolean) {
    this.scrollableBox.autoScroll = v;
  }

  /** Agent id currently being displayed. */
  selectedAgentId?: string;

  private readonly state: AgentViewerState;
  private readonly theme: Theme;
  private readonly tui: TUI;
  private readonly markdownTheme: MarkdownTheme;
  private readonly cwd: string;
  private readonly conversationRenderer: ConversationRenderer;
  private readonly scrollableBox: ScrollableBox;
  private readonly borderedContainer: BorderedContainer;

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

    this.scrollableBox = new ScrollableBox(tui, 0.85, 4);
    this.borderedContainer = new BorderedContainer(theme, undefined, 1, "warning");
    this.borderedContainer.addChild(this.scrollableBox);

    this.conversationRenderer = new ConversationRenderer({
      theme,
      markdownTheme,
      tui,
      cwd,
      toolRegistry,
    });
  }

  /**
   * Signal that new content has arrived. Rendering is stateless (full
   * component tree is rebuilt on every render call), so this is a no-op.
   */
  markDirty(): void {
    // no-op: render() always rebuilds from state
  }

  render(width: number): string[] {
    const { theme } = this;
    this.scrollableBox.clear();

    const entry = this.selectedAgentId ? this.state.getAgentEntry(this.selectedAgentId) : undefined;
    if (!entry) {
      this.scrollableBox.addChild(new Text(theme.fg("accent", "Agent Detail"), 0, 0));
      this.scrollableBox.addChild(new DynamicBorder((s: string) => theme.fg("muted", s)));
      this.scrollableBox.addChild(new Text(theme.fg("muted", "agent not found"), 0, 0));
      this.scrollableBox.addChild(
        new Text(theme.fg("muted", `${theme.fg("accent", "Esc")} back`), 0, 0),
      );
      return this.borderedContainer.render(width);
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
    this.scrollableBox.addChild(
      new Text(
        `${theme.fg(iconColor, icon)} ${theme.fg("accent", entry.id)} — ${theme.fg(statusColor, label)}`,
        0,
        0,
      ),
    );
    this.scrollableBox.addChild(new DynamicBorder((s: string) => theme.fg("muted", s)));

    // Summary
    if (entry.summary) {
      this.scrollableBox.addChild(new Text(theme.fg("accent", "Summary:"), 0, 0));
      this.scrollableBox.addChild(new Spacer(1));
      this.scrollableBox.addChild(new Text(entry.summary, 0, 0));
      this.scrollableBox.addChild(new Spacer(1));
    }

    // Conversation
    this.scrollableBox.addChild(new Text(theme.fg("accent", "Conversation:"), 0, 0));
    this.scrollableBox.addChild(new Spacer(1));
    const messages = this.state.getConversationMessages(entry.id);
    const convLines = this.conversationRenderer.render(
      messages,
      BorderedContainer.contentWidth(width),
    );
    if (convLines.length === 0) {
      this.scrollableBox.addChild(new Text(theme.fg("muted", "No conversation recorded."), 0, 0));
    } else {
      this.scrollableBox.addChild(new StaticContent(convLines));
    }
    this.scrollableBox.addChild(new Spacer(1));

    // Help text
    this.scrollableBox.addChild(
      new Text(
        theme.fg("muted", `${theme.fg("accent", "Esc")} back  ${theme.fg("accent", "↑↓")} scroll`),
        0,
        0,
      ),
    );

    return this.borderedContainer.render(width);
  }

  handleInput(data: string): void {
    this.scrollableBox.setCurrentAgent(this.selectedAgentId);
    this.scrollableBox.handleInput(data);
  }

  /**
   * Auto-scroll to bottom when new events arrive for the displayed agent.
   *
   * Delegates to {@link ScrollableBox.onStreamEvent} which handles
   * autoScroll flag, agent-scoping, and viewport clamping.
   */
  onStreamEvent(agentId: string): void {
    this.scrollableBox.setCurrentAgent(this.selectedAgentId);
    this.scrollableBox.onStreamEvent(agentId);
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
