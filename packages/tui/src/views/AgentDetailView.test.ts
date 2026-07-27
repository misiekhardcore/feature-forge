import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import type { MarkdownTheme, TUI } from "@earendil-works/pi-tui";
import { AgentViewerState } from "@feature-forge/tui";
import { AgentDetailView } from "@feature-forge/tui";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

function makeMockToolFormatter() {
  return { get: vi.fn(() => undefined) };
}

beforeAll(() => {
  initTheme("dark");
});

function makeTheme(): Theme {
  return {
    fg: vi.fn((_color: string, text: string) => text),
    bg: vi.fn((_color: string, text: string) => text),
    bold: vi.fn((text: string) => text),
    italic: vi.fn((text: string) => text),
    inverse: vi.fn((text: string) => text),
  } as unknown as Theme;
}

function makeMarkdownTheme(): MarkdownTheme {
  return {
    heading: vi.fn((text: string) => text),
    link: vi.fn((text: string) => text),
    linkUrl: vi.fn((text: string) => text),
    code: vi.fn((text: string) => text),
    codeBlock: vi.fn((text: string) => text),
    codeBlockBorder: vi.fn((text: string) => text),
    quote: vi.fn((text: string) => text),
    quoteBorder: vi.fn((text: string) => text),
    hr: vi.fn((text: string) => text),
    listBullet: vi.fn((text: string) => text),
    bold: vi.fn((text: string) => text),
    italic: vi.fn((text: string) => text),
    strikethrough: vi.fn((text: string) => text),
    underline: vi.fn((text: string) => text),
  };
}

function makeTui(overrides: Partial<Record<string, unknown>> = {}): TUI {
  return {
    requestRender: vi.fn(),
    terminal: { rows: 40, cols: 120 },
    ...overrides,
  } as unknown as TUI;
}

function makeMessageEndEvent(content: string, role = "assistant"): AgentEvent {
  return {
    type: "message_end",
    message: {
      role,
      content: [{ type: "text", text: content }],
    },
  } as unknown as AgentEvent;
}

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "agent-detail-view-test-"));
}

describe("AgentDetailView", () => {
  let state: AgentViewerState;
  let theme: Theme;
  let markdownTheme: MarkdownTheme;
  let tui: TUI;
  let view: AgentDetailView;

  beforeEach(() => {
    state = new AgentViewerState();
    theme = makeTheme();
    markdownTheme = makeMarkdownTheme();
    tui = makeTui();
    view = new AgentDetailView(
      state,
      theme,
      markdownTheme,
      tui,
      "/test/cwd",
      makeMockToolFormatter(),
    );
  });

  describe("render", () => {
    it("renders agent not found when no selectedAgentId", () => {
      view.selectedAgentId = undefined;
      const lines = view.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("Agent Detail");
      expect(joined).toContain("agent not found");
    });

    it("renders agent not found with Esc accent colouring", () => {
      view.selectedAgentId = undefined;
      view.render(80);
      // Esc should be rendered via theme.fg("accent", ...) in help text.
      expect(theme.fg).toHaveBeenCalledWith("accent", "Esc");
    });

    it("renders agent not found when selectedAgentId doesn't exist", () => {
      view.selectedAgentId = "nonexistent";
      const lines = view.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("agent not found");
    });

    it("renders bordered content", () => {
      view.selectedAgentId = undefined;
      const lines = view.render(80);
      const joined = lines.join("\n");
      // Top and bottom border chars should be present.
      expect(joined).toContain("┌");
      expect(joined).toContain("┐");
      expect(joined).toContain("└");
      expect(joined).toContain("┘");
      expect(joined).toContain("│");
    });

    it("renders agent detail with section spacers", () => {
      state.update({
        id: "builder",
        status: "done",
        createdAt: new Date(),
        role: "builder",
        passed: true,
        summary: "Built successfully",
      });
      state.pushStreamEvent("builder", makeMessageEndEvent("Hello world"), () => "line");
      view.selectedAgentId = "builder";

      const lines = view.render(100);
      const joined = lines.join("\n");
      // Spacer(1) creates blank lines between sections.
      expect(joined).toContain("Summary:");
      expect(joined).toContain("Conversation:");
      expect(joined).toContain("Esc");
      expect(joined).toContain("scroll");
    });

    it("renders agent detail with header and conversation", () => {
      state.update({ id: "builder", status: "started", createdAt: new Date(), role: "builder" });
      state.pushStreamEvent("builder", makeMessageEndEvent("Hello world"), () => "line");
      view.selectedAgentId = "builder";

      const lines = view.render(100);
      const joined = lines.join("\n");
      expect(joined).toContain("builder");
      expect(joined).toContain("running");
    });

    it("renders completed agent with summary", () => {
      state.update({
        id: "reviewer",
        status: "done",
        createdAt: new Date(),
        role: "reviewer",
        passed: true,
        summary: "Code looks great",
      });
      view.selectedAgentId = "reviewer";

      const lines = view.render(100);
      const joined = lines.join("\n");
      expect(joined).toContain("Code looks great");
    });

    it("renders errored agent", () => {
      state.update({
        id: "failing",
        status: "error",
        createdAt: new Date(),
        role: "tester",
        summary: "Something broke",
        errorMessage: "Something broke",
      });
      view.selectedAgentId = "failing";

      const lines = view.render(100);
      const joined = lines.join("\n");
      expect(joined).toContain("error");
    });

    it("shows no conversation recorded when no messages", () => {
      state.update({
        id: "builder",
        status: "done",
        createdAt: new Date(),
        passed: true,
        summary: "done",
      });
      view.selectedAgentId = "builder";

      const lines = view.render(100);
      const joined = lines.join("\n");
      expect(joined).toContain("No conversation recorded");
    });

    it("renders without error when terminal has no rows", () => {
      const tuiNoRows = makeTui({ terminal: { rows: undefined, cols: 120 } });
      const noTermView = new AgentDetailView(
        state,
        theme,
        markdownTheme,
        tuiNoRows,
        "/test/cwd",
        makeMockToolFormatter(),
      );

      state.update({ id: "builder", status: "started", createdAt: new Date(), role: "builder" });
      noTermView.selectedAgentId = "builder";
      const lines = noTermView.render(80);
      expect(lines.length).toBeGreaterThan(0);
    });
  });

  describe("scroll delegation", () => {
    it("get/set scrollOffsetEnd delegates to ScrollableBox", () => {
      view.scrollOffsetEnd = 10;
      expect(view.scrollOffsetEnd).toBe(10);
      view.scrollOffsetEnd = 0;
      expect(view.scrollOffsetEnd).toBe(0);
    });

    it("get/set autoScroll delegates to ScrollableBox", () => {
      view.autoScroll = true;
      expect(view.autoScroll).toBe(true);
      view.autoScroll = false;
      expect(view.autoScroll).toBe(false);
    });
  });

  describe("handleInput", () => {
    it("scrolls up on arrow up", () => {
      view.scrollOffsetEnd = 5;
      view.handleInput("\x1b[A");
      expect(view.scrollOffsetEnd).toBe(6);
    });

    it("scrolls down on arrow down", () => {
      view.scrollOffsetEnd = 5;

      // Push enough content to create scrollable area exceeding viewport.
      state.update({ id: "builder", status: "started", createdAt: new Date(), role: "builder" });
      for (let i = 0; i < 50; i++) {
        state.pushStreamEvent(
          "builder",
          {
            type: "message_start",
            message: { role: "assistant", content: [] },
          } as unknown as AgentEvent,
          () => `start ${i}`,
        );
        state.pushStreamEvent("builder", makeMessageEndEvent(`Line ${i}`), () => `event ${i}`);
      }
      view.selectedAgentId = "builder";
      // Render first to compute scroll bounds.
      view.render(100);

      // scrollOffsetEnd starts at 5, ArrowDown decrements toward bottom.
      expect(view.scrollOffsetEnd).toBe(5);
      view.handleInput("\x1b[B");
      expect(view.scrollOffsetEnd).toBe(4);
    });

    it("enables autoScroll when scrolling to bottom", () => {
      state.update({ id: "builder", status: "started", createdAt: new Date(), role: "builder" });
      for (let i = 0; i < 50; i++) {
        state.pushStreamEvent(
          "builder",
          {
            type: "message_start",
            message: { role: "assistant", content: [] },
          } as unknown as AgentEvent,
          () => `start ${i}`,
        );
        state.pushStreamEvent(
          "builder",
          makeMessageEndEvent(`Line ${i} with enough text to wrap across multiple lines`),
          () => `event ${i}`,
        );
      }
      view.selectedAgentId = "builder";
      view.render(100);

      // Scroll down many times to reach bottom.
      for (let i = 0; i < 200; i++) {
        view.handleInput("\x1b[B");
      }
      view.render(100);
      expect(view.autoScroll).toBe(true);
      const offsetAfterScroll = view.scrollOffsetEnd;
      expect(offsetAfterScroll).toBe(0);
      // Scrolling further down should keep at bottom.
      view.handleInput("\x1b[B");
      view.render(100);
      expect(view.scrollOffsetEnd).toBe(0);
    });
  });

  describe("onStreamEvent", () => {
    it("auto-scrolls when autoScroll is enabled and agent matches", () => {
      state.update({ id: "builder", status: "started", createdAt: new Date(), role: "builder" });
      for (let i = 0; i < 50; i++) {
        state.pushStreamEvent(
          "builder",
          {
            type: "message_start",
            message: { role: "assistant", content: [] },
          } as unknown as AgentEvent,
          () => `start ${i}`,
        );
        state.pushStreamEvent("builder", makeMessageEndEvent(`Line ${i}`), () => `event ${i}`);
      }
      view.selectedAgentId = "builder";
      view.autoScroll = true;
      view.render(100);

      // Push another event to trigger auto-scroll.
      state.pushStreamEvent(
        "builder",
        {
          type: "message_start",
          message: { role: "assistant", content: [] },
        } as unknown as AgentEvent,
        () => "new start",
      );
      state.pushStreamEvent("builder", makeMessageEndEvent("update"), () => "last line");
      view.onStreamEvent("builder");

      // onStreamEvent sets scrollOffsetEnd to 0 to signal "scroll to bottom".
      expect(view.scrollOffsetEnd).toBe(0);
      view.render(100);

      // After render, scrollOffsetEnd stays 0 (at bottom).
      const clampedOffset = view.scrollOffsetEnd;
      expect(clampedOffset).toBe(0);
      // Scrolling down again should keep it at 0.
      view.handleInput("\x1b[B");
      view.render(100);
      expect(view.scrollOffsetEnd).toBe(0);
      expect(view.autoScroll).toBe(true);
    });

    it("does not auto-scroll when autoScroll is disabled", () => {
      state.update({ id: "builder", status: "started", createdAt: new Date(), role: "builder" });
      view.selectedAgentId = "builder";
      view.autoScroll = false;
      view.scrollOffsetEnd = 0;

      state.pushStreamEvent("builder", makeMessageEndEvent("update"), () => "line2");
      view.onStreamEvent("builder");

      expect(view.scrollOffsetEnd).toBe(0);
    });
  });

  describe("loadConversationEvents", () => {
    it("returns empty array when no agent selected", async () => {
      view.selectedAgentId = undefined;
      const events = await view.loadConversationEvents();
      expect(events).toEqual([]);
    });

    it("loads events from disk for selected agent", async () => {
      const tmpDir = makeTempDir();
      try {
        state.setStreamDir(tmpDir);
        state.pushStreamEvent("builder", makeMessageEndEvent("test msg"), () => "line");
        void state.prepopulateStreamFiles(tmpDir);
        view.selectedAgentId = "builder";

        const events = await view.loadConversationEvents();
        expect(events.length).toBeGreaterThanOrEqual(1);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("markDirty", () => {
    it("marks conversation cache dirty", () => {
      state.update({ id: "builder", status: "started", createdAt: new Date(), role: "builder" });
      state.pushStreamEvent("builder", makeMessageEndEvent("Hello"), () => "line");
      view.selectedAgentId = "builder";
      view.render(100);

      view.markDirty();
      // Verify rendering again works after marking dirty
      const lines = view.render(100);
      expect(lines.length).toBeGreaterThan(0);
    });
  });
});
