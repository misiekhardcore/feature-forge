import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { DynamicBorder, type Theme } from "@earendil-works/pi-coding-agent";
import { type MarkdownTheme, Spacer, Text, type TUI } from "@earendil-works/pi-tui";

import type { ToolRegistry } from "../../registry/ToolRegistry";
import { AgentViewerState } from "./AgentViewerState";
import { AgentDisplayHelpers, BorderedContainer, ScrollableBox, StaticContent } from "@feature-forge/tui";
import { ConversationRenderer } from "./ConversationRenderer";

/**
 * Renders detailed view of a single agent's conversation and logs.
 *
 * Composes {@link BorderedContainer} > {@link ScrollableBox} with
 * conversation-line caching for rendering performance (#154).
 *
 * This class does not extend {@link Container} because it composes
 * {@link BorderedContainer}, {@link ScrollableBox}, and
 * {@link ConversationRenderer} internally. The intended public API is
 * {@code render()}, {@code handleInput()}, {@code setCurrentAgent()},
 * and {@code scrollToBottom()}. Exposing {@code children}/{@code addChild}
 * would break encapsulation.
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

  // ── Conversation cache (#154 perf) ───────────────────────

  /** Cached rendered conversation lines from the last render call. */
  private cachedConversationLines: string[] = [];

  /** Width at which the cached conversation lines were rendered. -1 means not cached. */
  private cachedConversationWidth = -1;

  /** Whether the conversation line count cache needs to be recomputed. */
  private conversationLinesDirty = true;

  /** Heuristic: average lines rendered per message, tracked per-agent. */
  private avgLinesPerMessage = new Map<string, number>();

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
   * Mark the conversation cache as dirty — the next render will
   * recompute conversation lines.
   */
  markDirty(): void {
    this.conversationLinesDirty = true;
    this.cachedConversationWidth = -1;
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

    // Conversation (with caching from #154)
    this.scrollableBox.addChild(new Text(theme.fg("accent", "Conversation:"), 0, 0));
    this.scrollableBox.addChild(new Spacer(1));

    const contentWidth = BorderedContainer.contentWidth(width);
    let conversationLines: string[];

    if (this.conversationLinesDirty || width !== this.cachedConversationWidth) {
      const messages = this.state.getConversationMessages(entry.id);
      conversationLines = this.conversationRenderer.render(messages, contentWidth);
      this.cachedConversationLines = conversationLines;
      this.cachedConversationWidth = width;
      this.conversationLinesDirty = false;
      this.avgLinesPerMessage.set(
        entry.id,
        messages.length > 0 ? conversationLines.length / messages.length : 1,
      );
    } else {
      conversationLines = this.cachedConversationLines;
    }

    if (conversationLines.length === 0) {
      this.scrollableBox.addChild(new Text(theme.fg("muted", "No conversation recorded."), 0, 0));
    } else {
      this.scrollableBox.addChild(new StaticContent(conversationLines));
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
