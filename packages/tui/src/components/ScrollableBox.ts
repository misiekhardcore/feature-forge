import { Container, Key, matchesKey, type TUI } from "@earendil-works/pi-tui";

/**
 * Container that clips its children to a scrollable viewport.
 *
 * Extends {@link Container} rather than {@link Box} because {@link Box}
 * adds padding and background decorations — unnecessary overhead for a
 * scrolling viewport whose only responsibility is clipping and offset
 * management. {@link Container} provides the {@code children} iteration
 * model which {@code ScrollableBox} overrides in {@code render()} to apply
 * viewport clipping and scroll-offset logic.
 *
 * Adds scrolling (page up/down, home/end, arrow keys) and auto-scroll
 * behaviour for the last-part-of-content pattern used by live-streaming views.
 */
export class ScrollableBox extends Container {
  scrollOffsetEnd = 0;
  autoScroll = false;

  private currentAgentId?: string;
  private readonly tui: TUI;
  private readonly maxHeightPercent: number;
  private readonly borderOverhead: number;
  private lastTotalLines = 0;

  constructor(tui: TUI, maxHeightPercent: number, borderOverhead = 4) {
    super();
    this.tui = tui;
    this.maxHeightPercent = maxHeightPercent;
    this.borderOverhead = borderOverhead;
  }

  render(width: number): string[] {
    const allLines: string[] = [];
    for (const child of this.children) {
      for (const line of child.render(width)) {
        allLines.push(line);
      }
    }
    this.lastTotalLines = allLines.length;

    const viewportHeight = this.computeViewportHeight();

    // Re-enable autoScroll when at bottom (scrollOffsetEnd === 0).
    if (this.scrollOffsetEnd === 0) {
      this.autoScroll = true;
    }
    const maxEnd = Math.max(0, allLines.length - viewportHeight);
    this.scrollOffsetEnd = Math.max(0, Math.min(this.scrollOffsetEnd, maxEnd));

    const startIndex = Math.max(0, allLines.length - viewportHeight - this.scrollOffsetEnd);
    return allLines.slice(startIndex, Math.min(startIndex + viewportHeight, allLines.length));
  }

  handleInput(data: string): void {
    // Compute viewport now so page up/down use the right value.
    const viewportHeight = this.computeViewportHeight();

    if (matchesKey(data, Key.up)) {
      this.autoScroll = false;
      this.scrollOffsetEnd += 1;
      this.tui.requestRender();
    } else if (matchesKey(data, Key.down)) {
      this.scrollOffsetEnd = Math.max(0, this.scrollOffsetEnd - 1);
      this.tui.requestRender();
    } else if (matchesKey(data, Key.pageUp)) {
      this.autoScroll = false;
      this.scrollOffsetEnd += viewportHeight;
      this.tui.requestRender();
    } else if (matchesKey(data, Key.pageDown)) {
      this.scrollOffsetEnd = Math.max(0, this.scrollOffsetEnd - viewportHeight);
      this.tui.requestRender();
    } else if (matchesKey(data, Key.home)) {
      this.autoScroll = false;
      this.scrollOffsetEnd = Math.max(0, this.lastTotalLines - viewportHeight);
      this.tui.requestRender();
    } else if (matchesKey(data, Key.end)) {
      this.scrollToBottom();
      this.tui.requestRender();
    }
  }

  scrollToBottom(): void {
    this.scrollOffsetEnd = 0;
    this.autoScroll = true;
  }

  /**
   * Auto-scroll to bottom for stream events.
   *
   * When {@link agentId} is provided, only scrolls if it matches
   * the currently active agent (set via {@link setCurrentAgent}).
   */
  onStreamEvent(agentId?: string): void {
    if (!this.autoScroll) return;
    if (
      agentId !== undefined &&
      this.currentAgentId !== undefined &&
      agentId !== this.currentAgentId
    ) {
      return;
    }
    this.scrollToBottom();
    this.tui.requestRender();
  }

  /** Set the currently-displayed agent id for event scoping. */
  setCurrentAgent(agentId: string | undefined): void {
    this.currentAgentId = agentId;
  }

  private computeViewportHeight(): number {
    const termRows = this.tui?.terminal?.rows;
    if (!termRows || termRows < 1) return Math.max(1, 15 - this.borderOverhead);
    const maxHeight = Math.floor(this.maxHeightPercent * termRows);
    return Math.max(1, maxHeight - this.borderOverhead);
  }
}
