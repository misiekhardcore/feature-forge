import { Container, type TUI } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ScrollableBox } from "./ScrollableBox";

function makeTui(overrides: Partial<Record<string, unknown>> = {}): TUI {
  return {
    requestRender: vi.fn(),
    terminal: { rows: 40, cols: 120 },
    ...overrides,
  } as unknown as TUI;
}

class FakeLines extends Container {
  private readonly count: number;
  constructor(count: number) {
    super();
    this.count = count;
  }
  render(_width: number): string[] {
    return Array.from({ length: this.count }, (_, i) => `line ${i}`);
  }
}

describe("ScrollableBox", () => {
  let tui: TUI;
  let box: ScrollableBox;

  beforeEach(() => {
    tui = makeTui();
    box = new ScrollableBox(tui, 0.5);
  });

  describe("computeViewportHeight", () => {
    it("uses terminal rows when available", () => {
      const tuiWithRows = makeTui({ terminal: { rows: 50, cols: 100 } });
      const sb = new ScrollableBox(tuiWithRows, 0.5, 0);
      // 50 * 0.5 = 25, minus 0 borderOverhead = 25.
      // Add 30 lines so viewport caps to 25.
      sb.addChild(new FakeLines(30));
      const lines = sb.render(80);
      expect(lines.length).toBe(25);
    });

    it("falls back to 15 minus borderOverhead when terminal rows unavailable", () => {
      const tuiNoTerm = makeTui({ terminal: undefined });
      const sb = new ScrollableBox(tuiNoTerm, 0.5, 0);
      sb.addChild(new FakeLines(20));
      const lines = sb.render(80);
      // Fallback: Math.max(1, 15 - 0) = 15
      expect(lines.length).toBe(15);
    });

    it("applies borderOverhead to fallback when terminal rows unavailable", () => {
      const tuiNoTerm = makeTui({ terminal: undefined });
      const sb = new ScrollableBox(tuiNoTerm, 0.5, 4);
      sb.addChild(new FakeLines(20));
      const lines = sb.render(80);
      // Fallback: Math.max(1, 15 - 4) = 11
      expect(lines.length).toBe(11);
    });

    it("falls back to 15 minus borderOverhead when terminal rows < 1", () => {
      const tuiZeroRows = makeTui({ terminal: { rows: 0, cols: 100 } });
      const sb = new ScrollableBox(tuiZeroRows, 0.5, 0);
      sb.addChild(new FakeLines(20));
      const lines = sb.render(80);
      // Fallback: Math.max(1, 15 - 0) = 15
      expect(lines.length).toBe(15);
    });

    it("returns at least 1", () => {
      const tuiSmall = makeTui({ terminal: { rows: 1, cols: 100 } });
      const sb = new ScrollableBox(tuiSmall, 0.1, 0);
      sb.addChild(new FakeLines(5));
      const lines = sb.render(80);
      expect(lines.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("render", () => {
    it("returns empty when no children", () => {
      const lines = box.render(80);
      expect(lines).toEqual([]);
    });

    it("shows all lines when content fits viewport", () => {
      box.addChild(new FakeLines(5));
      const lines = box.render(80);
      expect(lines).toEqual(["line 0", "line 1", "line 2", "line 3", "line 4"]);
    });

    it("clips content when it exceeds viewport height", () => {
      box.addChild(new FakeLines(25));
      const lines = box.render(80);
      // Viewport height = floor(0.5 * 40) - 4 = 20 - 4 = 16
      expect(lines.length).toBe(16);
      expect(lines[0]).toBe("line 0");
    });

    it("shifts viewport by scrollOffset", () => {
      box.addChild(new FakeLines(30));
      box.scrollOffset = 5;
      const lines = box.render(80);
      expect(lines[0]).toBe("line 5");
    });

    it("clamps scrollOffset to max when it exceeds content", () => {
      box.addChild(new FakeLines(5));
      box.scrollOffset = 100;
      box.render(80);
      // 5 lines, viewport = 16, maxOffset = max(0, 5-16) = 0
      expect(box.scrollOffset).toBe(0);
    });

    it("clamps scrollOffset when it exceeds max and re-enables autoScroll at bottom", () => {
      box.addChild(new FakeLines(30));
      box.scrollOffset = 100;
      box.autoScroll = false;
      box.render(80);
      // scrollOffset is clamped to max (30 - 16 = 14).
      // Since scrollOffset (100) >= maxOffset (14), autoScroll re-enables.
      expect(box.scrollOffset).toBe(14);
      expect(box.autoScroll).toBe(true);
    });

    it("sticky-scrolls to bottom when autoScroll is true and offset reaches max", () => {
      box.addChild(new FakeLines(30));
      // maxOffset = 30 - 16 = 14. Set scrollOffset >= maxOffset so autoScroll kicks in
      box.scrollOffset = 15;
      box.autoScroll = true;
      box.render(80);
      // autoScroll + scrollOffset >= maxOffset => clamped to maxOffset exactly
      expect(box.scrollOffset).toBe(14);
    });

    it("preserves autoScroll=false when not at bottom", () => {
      box.addChild(new FakeLines(30));
      box.scrollOffset = 0;
      box.autoScroll = false;
      box.render(80);
      expect(box.autoScroll).toBe(false);
    });

    it("re-enables autoScroll when manually scrolling to bottom", () => {
      box.addChild(new FakeLines(30));
      // maxOffset = 30 - 16 = 14. Set scrollOffset past it.
      box.scrollOffset = 14;
      box.autoScroll = false;
      box.render(80);
      // At bottom → autoScroll re-enabled.
      expect(box.autoScroll).toBe(true);
      // scrollOffset is clamped to max.
      expect(box.scrollOffset).toBe(14);
    });
  });

  describe("handleInput", () => {
    it("scrolls up on arrow up", () => {
      box.addChild(new FakeLines(30));
      box.scrollOffset = 5;
      box.autoScroll = false;
      box.handleInput("\x1b[A");
      expect(box.scrollOffset).toBe(4);
      expect(tui.requestRender).toHaveBeenCalled();
    });

    it("disables autoScroll on arrow up", () => {
      box.addChild(new FakeLines(30));
      box.autoScroll = true;
      box.handleInput("\x1b[A");
      expect(box.autoScroll).toBe(false);
      expect(box.scrollOffset).toBe(0);
    });

    it("scrolls down on arrow down", () => {
      box.addChild(new FakeLines(30));
      box.scrollOffset = 0;
      box.handleInput("\x1b[B");
      expect(box.scrollOffset).toBe(1);
      expect(tui.requestRender).toHaveBeenCalled();
    });

    it("does not scroll past top on arrow up", () => {
      box.addChild(new FakeLines(30));
      box.scrollOffset = 0;
      box.handleInput("\x1b[A");
      expect(box.scrollOffset).toBe(0);
    });

    it("scrolls page up", () => {
      box.addChild(new FakeLines(30));
      box.scrollOffset = 20;
      box.autoScroll = false;
      box.handleInput("\x1b[5~");
      // viewport height = floor(0.5 * 40) - 4 = 16
      expect(box.scrollOffset).toBe(4);
      expect(box.autoScroll).toBe(false);
      expect(tui.requestRender).toHaveBeenCalled();
    });

    it("scrolls page down", () => {
      box.addChild(new FakeLines(30));
      box.scrollOffset = 0;
      box.handleInput("\x1b[6~");
      // viewport height = 16
      expect(box.scrollOffset).toBe(16);
      expect(tui.requestRender).toHaveBeenCalled();
    });

    it("jumps to top on home", () => {
      box.addChild(new FakeLines(30));
      box.scrollOffset = 10;
      box.autoScroll = true;
      box.handleInput("\x1b[H");
      expect(box.scrollOffset).toBe(0);
      expect(box.autoScroll).toBe(false);
      expect(tui.requestRender).toHaveBeenCalled();
    });

    it("jumps to bottom on end", () => {
      box.addChild(new FakeLines(30));
      box.scrollOffset = 0;
      box.autoScroll = false;
      box.handleInput("\x1b[F");
      expect(box.scrollOffset).toBe(Number.MAX_SAFE_INTEGER);
      expect(box.autoScroll).toBe(true);
      expect(tui.requestRender).toHaveBeenCalled();
    });
  });

  describe("scrollToBottom", () => {
    it("sets scrollOffset to MAX_SAFE_INTEGER and enables autoScroll", () => {
      box.scrollToBottom();
      expect(box.scrollOffset).toBe(Number.MAX_SAFE_INTEGER);
      expect(box.autoScroll).toBe(true);
    });
  });

  describe("onStreamEvent", () => {
    it("scrolls to bottom when autoScroll is enabled", () => {
      box.addChild(new FakeLines(30));
      box.autoScroll = true;
      box.scrollOffset = 5;
      box.onStreamEvent();
      expect(box.scrollOffset).toBe(Number.MAX_SAFE_INTEGER);
    });

    it("does nothing when autoScroll is disabled", () => {
      box.addChild(new FakeLines(30));
      box.autoScroll = false;
      box.scrollOffset = 5;
      box.onStreamEvent();
      expect(box.scrollOffset).toBe(5);
    });

    it("scrolls for matching agentId when currentAgent is set", () => {
      box.addChild(new FakeLines(30));
      box.autoScroll = true;
      box.scrollOffset = 5;
      box.setCurrentAgent("agent-1");
      box.onStreamEvent("agent-1");
      expect(box.scrollOffset).toBe(Number.MAX_SAFE_INTEGER);
    });

    it("ignores event for non-matching agentId", () => {
      box.addChild(new FakeLines(30));
      box.autoScroll = true;
      box.scrollOffset = 5;
      box.setCurrentAgent("agent-1");
      box.onStreamEvent("agent-2");
      expect(box.scrollOffset).toBe(5);
    });

    it("scrolls when no currentAgent is set (unscoped mode)", () => {
      box.addChild(new FakeLines(30));
      box.autoScroll = true;
      box.scrollOffset = 5;
      box.onStreamEvent("any-agent");
      expect(box.scrollOffset).toBe(Number.MAX_SAFE_INTEGER);
    });
  });

  describe("borderOverhead", () => {
    it("custom borderOverhead affects viewport size", () => {
      box.addChild(new FakeLines(30));
      const defaultLines = box.render(80);
      // default borderOverhead = 4, vh = 20 - 4 = 16

      const tui2 = makeTui();
      const boxWithZeroOH = new ScrollableBox(tui2, 0.5, 0);
      boxWithZeroOH.addChild(new FakeLines(30));
      const zeroLines = boxWithZeroOH.render(80);
      // vh = 20 - 0 = 20

      expect(zeroLines.length).toBeGreaterThan(defaultLines.length);
    });
  });
});
