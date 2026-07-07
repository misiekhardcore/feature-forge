import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { Key } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentViewerEntry } from "./AgentViewerOverlay";
import { AgentViewerOverlay } from "./AgentViewerOverlay";

// ── ANSI key sequences ──────────────────────────────────────
const UP = "\x1b[A";
const DOWN = "\x1b[B";
const ESCAPE = "\x1b";
const ENTER = "\r";

// ── Helpers ──────────────────────────────────────────────────

function makeTheme(): Theme {
  return {
    fg: vi.fn((_color: string, text: string) => text),
  } as unknown as Theme;
}

function makeTui(): TUI {
  return {
    requestRender: vi.fn(),
  } as unknown as TUI;
}

function makeDone(): () => void {
  return vi.fn();
}

function makeEntry(
  id: string,
  status: string,
  overrides: Partial<Omit<AgentViewerEntry, "id" | "status">> = {},
): AgentViewerEntry {
  return { id, status, ...overrides };
}

function makeOverlay(tui?: TUI, theme?: Theme, done?: () => void): AgentViewerOverlay {
  return new AgentViewerOverlay(tui ?? makeTui(), theme ?? makeTheme(), done ?? makeDone());
}

// ── Tests ────────────────────────────────────────────────────

describe("AgentViewerOverlay", () => {
  describe("constructor", () => {
    it("starts with zero entries", () => {
      const overlay = makeOverlay();
      expect(overlay.entryCount).toBe(0);
    });

    it("starts in list view mode", () => {
      const overlay = makeOverlay();
      expect(overlay.viewMode).toBe("list");
    });

    it("starts with selectedIndex at 0", () => {
      const overlay = makeOverlay();
      expect(overlay.selectedIndex).toBe(0);
    });

    it("accepts tui, theme, and done callback", () => {
      const tui = makeTui();
      const theme = makeTheme();
      const done = vi.fn();
      const overlay = new AgentViewerOverlay(tui, theme, done);

      expect(overlay.entryCount).toBe(0);
      expect(overlay.viewMode).toBe("list");
    });
  });

  describe("Component interface", () => {
    it("implements render", () => {
      const overlay = makeOverlay();
      const lines = overlay.render(80);

      expect(lines).toBeInstanceOf(Array);
      expect(lines.length).toBeGreaterThan(0);
    });

    it("implements handleInput", () => {
      const overlay = makeOverlay();
      expect(() => overlay.handleInput(UP)).not.toThrow();
    });

    it("implements invalidate", () => {
      const overlay = makeOverlay();
      expect(() => overlay.invalidate()).not.toThrow();
    });
  });

  describe("render", () => {
    it("shows header in list view", () => {
      const overlay = makeOverlay();
      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Agent Viewer");
    });

    it("shows 'no agents running' when empty", () => {
      const overlay = makeOverlay();
      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("no agents running");
    });

    it("shows agent entries with status icons in list view", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "done", { summary: "Built successfully" }));

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("✓");
      expect(joined).toContain("builder");
      expect(joined).toContain("[done]");
      expect(joined).toContain("Built successfully");
    });

    it("shows selected cursor for the selected agent", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.update(makeEntry("reviewer", "done"));

      overlay.selectedIndex = 0;
      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("▶");
    });

    it("shows help text in list view", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("navigate");
      expect(joined).toContain("close");
    });

    it("renders detail view when viewMode is detail", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "done", { summary: "Built successfully" }));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("builder");
      expect(joined).toContain("Built successfully");
      expect(joined).toContain("Summary");
      expect(joined).toContain("Esc");
    });

    it("shows 'agent not found' in detail view for unknown agent", () => {
      const overlay = makeOverlay();
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "nonexistent";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("agent not found");
    });

    it("shows back help text in detail view", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Esc");
      expect(joined).toContain("scroll");
    });

    it("shows raw output when present in list view", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "done", { raw: "output line 1\noutput line 2" }));

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("output line 1");
      expect(joined).toContain("output line 2");
    });

    it("shows raw output when present in detail view", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "done", { raw: "detail raw output" }));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Raw output");
      expect(joined).toContain("detail raw output");
    });

    it("truncates raw output beyond default max", () => {
      const overlay = makeOverlay();
      const longOutput = "x".repeat(600);
      overlay.update(makeEntry("builder", "done", { raw: longOutput }));

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("...");
      expect(joined).not.toContain(longOutput);
    });

    it("respects width parameter for separator", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "done"));

      const narrowLines = overlay.render(30);
      const wideLines = overlay.render(100);

      const narrowJoined = narrowLines.join("\n");
      const wideJoined = wideLines.join("\n");

      expect(narrowJoined).toContain("─");
      expect(wideJoined).toContain("─");
    });

    it("shows last stream line for started agents in list view", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("tool_use: read");
      expect(joined).toContain("⏳");
    });

    it("does not show stream line for done agents in list view", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "done", { summary: "Build passed" }));
      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).not.toContain("tool_use: read");
      expect(joined).toContain("Build passed");
    });

    it("shows stream tail in detail view when available", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-overlay-test-"));
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("exec-1", tmpDir);
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", { type: "message_start", role: "assistant" });

      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Stream log");
      expect(joined).toContain("message_start: assistant");

      overlay.dispose();
    });

    it("shows last stream line in detail view as fallback", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Last event");
      expect(joined).toContain("tool_use: read");
    });

    it("truncates long last stream line to fit width in list view", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      const longLine = "x".repeat(100);
      overlay.pushStreamEvent("builder", { type: "tool_use", tool: longLine });

      const lines = overlay.render(40);
      const joined = lines.join("\n");

      // Should be truncated to fit within width 40 minus 4-space indent.
      expect(joined).toContain("tool_use: xxx");
      expect(joined).toContain("...");
      // The full long line should not appear.
      expect(joined).not.toContain(longLine);
    });

    it("truncates long last stream line to fit width in detail view", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      const longLine = "y".repeat(100);
      overlay.pushStreamEvent("builder", { type: "message_start", role: longLine });
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(50);
      const joined = lines.join("\n");

      // Should show truncated line with ellipsis.
      expect(joined).toContain("Last event");
      expect(joined).toContain("...");
      // The full long line should not appear.
      expect(joined).not.toContain(longLine);
    });

    it("does not truncate short last stream lines", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      const shortLine = "tool_use: read";
      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain(shortLine);
      expect(joined).not.toContain("...");
    });
  });

  describe("Key constants", () => {
    it("defines expected navigation key identifiers", () => {
      expect(Key.up).toBe("up");
      expect(Key.down).toBe("down");
      expect(Key.escape).toBe("escape");
      expect(Key.enter).toBe("enter");
    });
  });

  describe("ANSI sequence input handling", () => {
    it("handles alternative ANSI up arrow sequence \\x1bOA", () => {
      const tui = makeTui();
      const overlay = makeOverlay(tui);
      overlay.update(makeEntry("a", "started"));
      overlay.update(makeEntry("b", "started"));

      overlay.handleInput("\x1bOA");

      expect(overlay.selectedIndex).toBe(1);
      expect(tui.requestRender).toHaveBeenCalled();
    });

    it("handles alternative ANSI down arrow sequence \\x1bOB", () => {
      const tui = makeTui();
      const overlay = makeOverlay(tui);
      overlay.update(makeEntry("a", "started"));
      overlay.update(makeEntry("b", "started"));

      overlay.handleInput("\x1bOB");

      expect(overlay.selectedIndex).toBe(1);
      expect(tui.requestRender).toHaveBeenCalled();
    });

    it("handles Kitty protocol escape sequence", () => {
      const tui = makeTui();
      const overlay = makeOverlay(tui);
      overlay.update(makeEntry("builder", "started"));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      // Kitty CSI-u escape: \x1b[27u (codepoint 27, modifier 1)
      overlay.handleInput("\x1b[27u");

      expect(overlay.viewMode).toBe("list");
      expect(tui.requestRender).toHaveBeenCalled();
    });

    it("handles carriage return as enter in list view", () => {
      const tui = makeTui();
      const overlay = makeOverlay(tui);
      overlay.update(makeEntry("builder", "started"));

      overlay.handleInput(ENTER);

      expect(overlay.viewMode).toBe("detail");
      expect(overlay.selectedAgentId).toBe("builder");
    });

    it("handles numpad enter sequence in list view", () => {
      const tui = makeTui();
      const overlay = makeOverlay(tui);
      overlay.update(makeEntry("builder", "started"));

      // SS3 M (numpad enter)
      overlay.handleInput("\x1bOM");

      expect(overlay.viewMode).toBe("detail");
      expect(overlay.selectedAgentId).toBe("builder");
    });
  });

  describe("handleInput", () => {
    describe("list view", () => {
      it("calls onDone when escape is pressed", () => {
        const done = vi.fn();
        const overlay = makeOverlay(undefined, undefined, done);

        overlay.handleInput(ESCAPE);

        expect(done).toHaveBeenCalledOnce();
      });

      it("ignores non-navigation input in list view", () => {
        const done = vi.fn();
        const overlay = makeOverlay(undefined, undefined, done);
        overlay.update(makeEntry("a", "started"));

        overlay.handleInput("x");

        expect(done).not.toHaveBeenCalled();
        expect(overlay.viewMode).toBe("list");
      });

      it("navigates down with down key", () => {
        const tui = makeTui();
        const overlay = makeOverlay(tui);
        overlay.update(makeEntry("a", "started"));
        overlay.update(makeEntry("b", "started"));
        overlay.update(makeEntry("c", "started"));

        expect(overlay.selectedIndex).toBe(0);

        overlay.handleInput(DOWN);
        expect(overlay.selectedIndex).toBe(1);
        expect(tui.requestRender).toHaveBeenCalled();

        overlay.handleInput(DOWN);
        expect(overlay.selectedIndex).toBe(2);

        overlay.handleInput(DOWN);
        expect(overlay.selectedIndex).toBe(0);
      });

      it("navigates up with up key", () => {
        const tui = makeTui();
        const overlay = makeOverlay(tui);
        overlay.update(makeEntry("a", "started"));
        overlay.update(makeEntry("b", "started"));
        overlay.update(makeEntry("c", "started"));

        expect(overlay.selectedIndex).toBe(0);

        overlay.handleInput(UP);
        expect(overlay.selectedIndex).toBe(2);
        expect(tui.requestRender).toHaveBeenCalled();
      });

      it("does nothing on up/down when no agents exist", () => {
        const tui = makeTui();
        const overlay = makeOverlay(tui);

        overlay.handleInput(UP);
        overlay.handleInput(DOWN);

        expect(overlay.selectedIndex).toBe(0);
        // requestRender should not be called when there are no agents
        expect(tui.requestRender).not.toHaveBeenCalled();
      });

      it("switches to detail view on enter", () => {
        const tui = makeTui();
        const overlay = makeOverlay(tui);
        overlay.update(makeEntry("builder", "started"));
        overlay.update(makeEntry("reviewer", "done"));

        overlay.selectedIndex = 1;
        overlay.handleInput(ENTER);

        expect(overlay.viewMode).toBe("detail");
        expect(overlay.selectedAgentId).toBe("reviewer");
        expect(overlay.scrollOffset).toBe(0);
        expect(tui.requestRender).toHaveBeenCalled();
      });

      it("does nothing on enter when no agents exist", () => {
        const tui = makeTui();
        const overlay = makeOverlay(tui);

        overlay.handleInput(ENTER);

        expect(overlay.viewMode).toBe("list");
        expect(tui.requestRender).not.toHaveBeenCalled();
      });
    });

    describe("detail view", () => {
      it("returns to list view on escape", () => {
        const tui = makeTui();
        const done = vi.fn();
        const overlay = makeOverlay(tui, undefined, done);
        overlay.update(makeEntry("builder", "started"));
        overlay.viewMode = "detail";
        overlay.selectedAgentId = "builder";

        overlay.handleInput(ESCAPE);

        expect(overlay.viewMode).toBe("list");
        expect(overlay.selectedAgentId).toBeUndefined();
        expect(overlay.scrollOffset).toBe(0);
        expect(done).not.toHaveBeenCalled();
        expect(tui.requestRender).toHaveBeenCalled();
      });

      it("scrolls up with up key", () => {
        const tui = makeTui();
        const overlay = makeOverlay(tui);
        overlay.update(makeEntry("builder", "started"));
        overlay.viewMode = "detail";
        overlay.selectedAgentId = "builder";
        overlay.scrollOffset = 5;

        overlay.handleInput(UP);

        expect(overlay.scrollOffset).toBe(4);
        expect(tui.requestRender).toHaveBeenCalled();
      });

      it("does not scroll below 0 with up key", () => {
        const tui = makeTui();
        const overlay = makeOverlay(tui);
        overlay.update(makeEntry("builder", "started"));
        overlay.viewMode = "detail";
        overlay.selectedAgentId = "builder";
        overlay.scrollOffset = 0;

        overlay.handleInput(UP);

        expect(overlay.scrollOffset).toBe(0);
      });

      it("scrolls down with down key", () => {
        const tui = makeTui();
        const overlay = makeOverlay(tui);
        overlay.update(makeEntry("builder", "started"));
        overlay.viewMode = "detail";
        overlay.selectedAgentId = "builder";
        overlay.scrollOffset = 0;

        overlay.handleInput(DOWN);

        expect(overlay.scrollOffset).toBe(1);
        expect(tui.requestRender).toHaveBeenCalled();
      });

      it("shifts rendered content when scrolling down in detail view", () => {
        const tui = makeTui();
        const overlay = makeOverlay(tui);
        // Agent with raw output — detail view lines: header, separator,
        // "Raw output:", then each raw line, then blank, then help.
        // Total lines before raw: 3 (header + separator + "Raw output:").
        const rawLines = Array.from({ length: 10 }, (_, i) => `raw line ${i}`).join("\n");
        overlay.update(makeEntry("builder", "done", { raw: rawLines }));
        overlay.viewMode = "detail";
        overlay.selectedAgentId = "builder";
        overlay.scrollOffset = 0;

        // Capture initial render (scrollOffset = 0).
        const initialRender = overlay.render(80).join("\n");
        expect(initialRender).toContain("raw line 0");

        // Scroll down 6 times: skip header + separator + "Raw output:" +
        // raw line 0 + raw line 1 + raw line 2 → first visible = raw line 3.
        for (let i = 0; i < 6; i++) overlay.handleInput(DOWN);

        const scrolledRender = overlay.render(80).join("\n");

        // Content shifted — earlier raw lines are scrolled off the top.
        expect(scrolledRender).not.toBe(initialRender);
        expect(scrolledRender).toContain("raw line 3");
        expect(scrolledRender).not.toContain("raw line 0");
        expect(tui.requestRender).toHaveBeenCalled();
      });

      it("shifts rendered content when scrolling up in detail view", () => {
        const tui = makeTui();
        const overlay = makeOverlay(tui);
        const rawLines = Array.from({ length: 10 }, (_, i) => `raw line ${i}`).join("\n");
        overlay.update(makeEntry("builder", "done", { raw: rawLines }));
        overlay.viewMode = "detail";
        overlay.selectedAgentId = "builder";
        // Start scrolled well into the content.
        overlay.scrollOffset = 8;

        // At offset 8, lines 0–7 are skipped. First visible is index 8 = "raw line 5".
        const offsetRender = overlay.render(80).join("\n");
        expect(offsetRender).toContain("raw line 5");
        expect(offsetRender).not.toContain("raw line 0");

        // Scroll up 4 times → offset 4, first visible = index 4 = "raw line 1".
        for (let i = 0; i < 4; i++) overlay.handleInput(UP);

        const scrolledUpRender = overlay.render(80).join("\n");

        // Earlier content now visible — scrollOffset must shift the view.
        expect(scrolledUpRender).toContain("raw line 1");
        // Content that was visible at offset 8 may now be pushed off.
        // At offset 4, "raw line 5" is at index 8, which is 4 lines after the
        // first visible line — check that the render changed from offset 8.
        expect(scrolledUpRender).not.toBe(offsetRender);
        expect(tui.requestRender).toHaveBeenCalled();
      });

      it("does not scroll above first line when content is at top", () => {
        const tui = makeTui();
        const overlay = makeOverlay(tui);
        overlay.update(makeEntry("builder", "done", { raw: "line 1\nline 2" }));
        overlay.viewMode = "detail";
        overlay.selectedAgentId = "builder";
        overlay.scrollOffset = 0;

        const initialRender = overlay.render(80).join("\n");

        // Try to scroll up past the top.
        overlay.handleInput(UP);

        const stillTopRender = overlay.render(80).join("\n");

        // Render output should be unchanged — we're already at the top.
        expect(stillTopRender).toBe(initialRender);
        expect(overlay.scrollOffset).toBe(0);
      });

      it("clamps scrollOffset to visible line count on render", () => {
        const tui = makeTui();
        const overlay = makeOverlay(tui);
        overlay.update(makeEntry("builder", "done", { raw: "one\ntwo\nthree" }));
        overlay.viewMode = "detail";
        overlay.selectedAgentId = "builder";
        // Set scrollOffset well beyond the total line count.
        overlay.scrollOffset = 500;

        overlay.render(80);

        // After render, scrollOffset must be clamped to at most lines.length - 1.
        expect(overlay.scrollOffset).toBeLessThan(10);
        expect(overlay.scrollOffset).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe("update", () => {
    it("adds a new agent entry", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));

      expect(overlay.entryCount).toBe(1);
    });

    it("merges with existing entry for the same id", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.update(makeEntry("builder", "done", { summary: "Build passed" }));

      expect(overlay.entryCount).toBe(1);

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("[done]");
      expect(joined).toContain("Build passed");
    });

    it("tracks multiple agents independently", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.update(makeEntry("reviewer", "started"));
      overlay.update(makeEntry("builder", "done", { summary: "OK" }));

      expect(overlay.entryCount).toBe(2);

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("builder");
      expect(joined).toContain("reviewer");
      expect(joined).toContain("OK");
    });
  });

  describe("clearMemory", () => {
    it("removes all entries", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.update(makeEntry("reviewer", "done"));

      overlay.clearMemory();

      expect(overlay.entryCount).toBe(0);
    });

    it("resets view state", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.viewMode = "detail";
      overlay.selectedIndex = 2;
      overlay.selectedAgentId = "builder";
      overlay.scrollOffset = 10;

      overlay.clearMemory();

      expect(overlay.viewMode).toBe("list");
      expect(overlay.selectedIndex).toBe(0);
      expect(overlay.selectedAgentId).toBeUndefined();
      expect(overlay.scrollOffset).toBe(0);
    });

    it("resets to empty display after clearMemory", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));

      overlay.clearMemory();

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("no agents running");
      expect(joined).not.toContain("builder");
    });
  });

  describe("entryCount", () => {
    it("tracks the number of unique agent ids", () => {
      const overlay = makeOverlay();
      expect(overlay.entryCount).toBe(0);

      overlay.update(makeEntry("a", "started"));
      expect(overlay.entryCount).toBe(1);

      overlay.update(makeEntry("b", "started"));
      expect(overlay.entryCount).toBe(2);

      overlay.update(makeEntry("a", "done"));
      expect(overlay.entryCount).toBe(2);
    });
  });

  describe("statusIcon", () => {
    it("returns ✓ for done", () => {
      expect(AgentViewerOverlay.statusIcon("done")).toBe("✓");
    });

    it("returns ⏳ for started", () => {
      expect(AgentViewerOverlay.statusIcon("started")).toBe("⏳");
    });

    it("returns ✗ for error", () => {
      expect(AgentViewerOverlay.statusIcon("error")).toBe("✗");
    });

    it("returns ○ for unknown status", () => {
      expect(AgentViewerOverlay.statusIcon("paused")).toBe("○");
    });
  });

  describe("formatStreamEvent", () => {
    it("formats tool_use events as 'tool_use: <toolName>'", () => {
      const line = AgentViewerOverlay.formatStreamEvent({ type: "tool_use", tool: "read" });
      expect(line).toBe("tool_use: read");
    });

    it("formats tool_result events with a string content", () => {
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "tool_result",
        content: "some output",
      });
      expect(line).toBe("tool_result: some output");
    });

    it("formats message_start events as 'message_start: <role>'", () => {
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "message_start",
        role: "assistant",
      });
      expect(line).toBe("message_start: assistant");
    });

    it("formats assistant events as 'assistant: <text>'", () => {
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "assistant",
        text: "Here is the result.",
      });
      expect(line).toBe("assistant: Here is the result.");
    });

    it("returns just the type for events with no known detail", () => {
      const line = AgentViewerOverlay.formatStreamEvent({ type: "unknown_type" });
      expect(line).toBe("unknown_type");
    });

    it("serializes non-object events as JSON", () => {
      const line = AgentViewerOverlay.formatStreamEvent("plain string");
      expect(line).toBe('"plain string"');
    });

    it("truncates long JSON serialization to 120 characters", () => {
      const longString = "x".repeat(200);
      const line = AgentViewerOverlay.formatStreamEvent(longString);
      expect(line.length).toBeLessThanOrEqual(120);
      expect(line.endsWith("...")).toBe(true);
    });

    it("handles null event gracefully", () => {
      const line = AgentViewerOverlay.formatStreamEvent(null);
      expect(line).toBe("null");
    });
  });

  describe("pushStreamEvent", () => {
    it("stores the formatted stream line in memory for a given agent", () => {
      const overlay = makeOverlay();
      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });

      expect(overlay.getLastStreamLine("builder")).toBe("tool_use: read");
    });

    it("overwrites previous last line for the same agent", () => {
      const overlay = makeOverlay();
      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });
      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "write" });

      expect(overlay.getLastStreamLine("builder")).toBe("tool_use: write");
    });

    it("tracks last lines per agent independently", () => {
      const overlay = makeOverlay();
      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });
      overlay.pushStreamEvent("reviewer", { type: "tool_use", tool: "lint" });

      expect(overlay.getLastStreamLine("builder")).toBe("tool_use: read");
      expect(overlay.getLastStreamLine("reviewer")).toBe("tool_use: lint");
    });

    it("writes stream events to a filesystem log when executionId and streamDir are configured", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-stream-test-"));
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("exec-1", tmpDir);

      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });
      overlay.pushStreamEvent("builder", { type: "message_start", role: "assistant" });

      const tail = overlay.getStreamTail("builder");
      expect(tail).toContain("tool_use: read");
      expect(tail).toContain("message_start: assistant");

      overlay.dispose();
    });

    it("uses executionId as prefix in stream filenames", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-stream-test-"));
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("exec-42", tmpDir);

      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });

      // The file should be named with the executionId prefix.
      const expectedPath = join(tmpDir, "exec-42-builder.stream");
      expect(existsSync(expectedPath)).toBe(true);

      const content = readFileSync(expectedPath, "utf-8");
      expect(content).toContain("tool_use: read");

      overlay.dispose();
    });

    it("does not write to disk when executionId is not set", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-stream-test-"));
      const overlay = makeOverlay();
      // streamDir set but no executionId
      overlay.setAgentExecutionId("", tmpDir);

      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });

      // In-memory line should still be recorded.
      expect(overlay.getLastStreamLine("builder")).toBe("tool_use: read");

      overlay.dispose();
    });

    it("creates the stream directory if it does not exist", () => {
      const tmpDir = join(tmpdir(), `forge-stream-mkdir-${Date.now()}`);
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("exec-1", tmpDir);

      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });

      const tail = overlay.getStreamTail("builder");
      expect(tail).toContain("tool_use: read");

      overlay.dispose();
    });

    it("does not throw when streamDir filesystem operations fail", () => {
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("exec-1", "/nonexistent/path/that/should/fail");

      expect(() => {
        overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });
      }).not.toThrow();

      expect(overlay.getLastStreamLine("builder")).toBe("tool_use: read");

      overlay.dispose();
    });
  });

  describe("lastStreamLine", () => {
    it("returns empty string when no stream events have been pushed", () => {
      const overlay = makeOverlay();
      expect(overlay.lastStreamLine).toBe("");
    });

    it("returns the most recently recorded line across all agents", () => {
      const overlay = makeOverlay();
      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });
      overlay.pushStreamEvent("reviewer", { type: "tool_use", tool: "lint" });

      expect(overlay.lastStreamLine).toBe("tool_use: lint");
    });
  });

  describe("getStreamTail", () => {
    it("returns empty string when no streamDir was configured", () => {
      const overlay = makeOverlay();
      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });

      expect(overlay.getStreamTail("builder")).toBe("");
    });

    it("returns empty string when agent has no stream file", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-stream-test-"));
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("exec-1", tmpDir);

      expect(overlay.getStreamTail("unknown")).toBe("");

      overlay.dispose();
    });

    it("returns the last N lines from the stream file", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-stream-test-"));
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("exec-1", tmpDir);

      for (let i = 0; i < 5; i++) {
        overlay.pushStreamEvent("builder", { type: "tool_use", tool: `tool-${i}` });
      }

      const tail = overlay.getStreamTail("builder", 2);
      const tailLines = tail.split("\n");
      expect(tailLines).toHaveLength(2);
      expect(tailLines[0]).toBe("tool_use: tool-3");
      expect(tailLines[1]).toBe("tool_use: tool-4");

      overlay.dispose();
    });
  });

  describe("setAgentExecutionId", () => {
    it("configures execution id and stream directory", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-stream-test-"));
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("my-exec", tmpDir);

      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });
      expect(overlay.getStreamTail("builder")).toContain("tool_use: read");

      overlay.dispose();
    });

    it("overwrites previous executionId and streamDir when called again", () => {
      const tmpDir1 = mkdtempSync(join(tmpdir(), "forge-overwrite-1-"));
      const tmpDir2 = mkdtempSync(join(tmpdir(), "forge-overwrite-2-"));

      const overlay = makeOverlay();
      overlay.setAgentExecutionId("exec-first", tmpDir1);
      overlay.setAgentExecutionId("exec-second", tmpDir2);

      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });

      // File should be written using the second (overwritten) executionId in tmpDir2.
      const expectedPath = join(tmpDir2, "exec-second-builder.stream");
      expect(existsSync(expectedPath)).toBe(true);

      // File should NOT be in tmpDir1.
      const oldPath = join(tmpDir1, "exec-first-builder.stream");
      expect(existsSync(oldPath)).toBe(false);

      overlay.dispose();
    });

    it("sets executionId without streamDir", () => {
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("exec-no-dir");

      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });

      // In-memory should work.
      expect(overlay.getLastStreamLine("builder")).toBe("tool_use: read");
      // No disk file.
      expect(overlay.getStreamTail("builder")).toBe("");
    });

    it("does not write to disk when executionId is empty string", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-empty-exec-"));
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("", tmpDir);

      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });

      // In-memory line should still be recorded.
      expect(overlay.getLastStreamLine("builder")).toBe("tool_use: read");
      // No disk file because executionId is empty.
      const files = existsSync(tmpDir) ? readdirSync(tmpDir) : [];
      expect(files.filter((f: string) => f.endsWith(".stream"))).toHaveLength(0);

      overlay.dispose();
    });
  });

  describe("dispose", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "forge-dispose-test-"));
    });

    afterEach(() => {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Directory may already be removed by dispose.
      }
    });

    it("removes stream files written to disk", () => {
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("exec-1", tmpDir);

      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });

      const filePath = join(tmpDir, "exec-1-builder.stream");
      expect(existsSync(filePath)).toBe(true);

      overlay.dispose();

      expect(existsSync(filePath)).toBe(false);
    });

    it("resets agent entries on dispose", () => {
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("exec-1", tmpDir);
      overlay.update(makeEntry("builder", "started"));

      overlay.dispose();

      expect(overlay.entryCount).toBe(0);
    });

    it("resets view state on dispose", () => {
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("exec-1", tmpDir);
      overlay.viewMode = "detail";
      overlay.selectedIndex = 5;
      overlay.selectedAgentId = "builder";
      overlay.scrollOffset = 10;

      overlay.dispose();

      expect(overlay.viewMode).toBe("list");
      expect(overlay.selectedIndex).toBe(0);
      expect(overlay.selectedAgentId).toBeUndefined();
      expect(overlay.scrollOffset).toBe(0);
    });

    it("is safe to call multiple times", () => {
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("exec-1", tmpDir);
      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });

      overlay.dispose();
      expect(() => overlay.dispose()).not.toThrow();
    });

    it("does not throw when streamDir was never configured", () => {
      const overlay = makeOverlay();

      expect(() => overlay.dispose()).not.toThrow();
    });

    it("clears lastLines and streamFiles maps on dispose", () => {
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("exec-1", tmpDir);
      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });
      overlay.pushStreamEvent("reviewer", { type: "tool_use", tool: "lint" });

      expect(overlay.getLastStreamLine("builder")).toBe("tool_use: read");
      expect(overlay.getStreamTail("builder")).toContain("tool_use: read");

      overlay.dispose();

      // Both in-memory maps are cleared.
      expect(overlay.getLastStreamLine("builder")).toBeUndefined();
      expect(overlay.getStreamTail("builder")).toBe("");
    });
  });

  describe("handleInput edge cases", () => {
    describe("detail view unrecognized input", () => {
      it("ignores non-mapped keys in detail view", () => {
        const tui = makeTui();
        const overlay = makeOverlay(tui);
        overlay.update(makeEntry("builder", "started"));
        overlay.viewMode = "detail";
        overlay.selectedAgentId = "builder";
        overlay.scrollOffset = 3;

        // Reset mock after update() which calls requestRender.
        vi.mocked(tui.requestRender).mockClear();

        overlay.handleInput("x");

        // Scroll offset should not change, and no render should be requested.
        expect(overlay.scrollOffset).toBe(3);
        expect(tui.requestRender).not.toHaveBeenCalled();
      });

      it("ignores empty string in detail view", () => {
        const tui = makeTui();
        const overlay = makeOverlay(tui);
        overlay.update(makeEntry("builder", "started"));
        overlay.viewMode = "detail";
        overlay.selectedAgentId = "builder";

        // Reset mock after update() which calls requestRender.
        vi.mocked(tui.requestRender).mockClear();

        overlay.handleInput("");

        expect(tui.requestRender).not.toHaveBeenCalled();
        expect(overlay.viewMode).toBe("detail");
      });
    });

    describe("list view unrecognized input", () => {
      it("ignores empty string in list view", () => {
        const tui = makeTui();
        const done = vi.fn();
        const overlay = makeOverlay(tui, undefined, done);
        overlay.update(makeEntry("builder", "started"));

        // Reset mock after update() which calls requestRender.
        vi.mocked(tui.requestRender).mockClear();

        overlay.handleInput("");

        expect(done).not.toHaveBeenCalled();
        expect(tui.requestRender).not.toHaveBeenCalled();
        expect(overlay.viewMode).toBe("list");
      });

      it("handles escape with no agents present", () => {
        const done = vi.fn();
        const overlay = makeOverlay(undefined, undefined, done);

        overlay.handleInput(ESCAPE);

        expect(done).toHaveBeenCalledOnce();
      });
    });
  });

  describe("render edge cases", () => {
    it("handles selectedIndex set beyond entries length in list view", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.selectedIndex = 5;

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      // Should still render without errors — no ▶ cursor anywhere.
      expect(joined).toContain("builder");
      expect(joined).not.toContain("▶");
    });

    it("falls through to list view when viewMode is detail but selectedAgentId is undefined", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("reviewer", "done"));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = undefined;

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      // Renders list view, not detail view.
      expect(joined).toContain("Agent Viewer");
      expect(joined).toContain("reviewer");
      expect(joined).not.toContain("Agent Detail");
    });

    it("shows both summary and raw output together in list view", () => {
      const overlay = makeOverlay();
      overlay.update(
        makeEntry("builder", "done", { summary: "Build passed", raw: "Full output here" }),
      );

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Build passed");
      expect(joined).toContain("Full output here");
    });

    it("handles zero width gracefully", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));

      const lines = overlay.render(0);

      expect(lines).toBeInstanceOf(Array);
      // Should not throw.
    });

    it("handles detail view with empty-string selectedAgentId as list view", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      // Falls through to list view because empty string is falsy.
      expect(joined).toContain("Agent Viewer");
      expect(joined).not.toContain("Agent Detail");
    });

    it("clamps selectedIndex when it exceeds entries length during list render", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("agent-a", "started"));
      overlay.update(makeEntry("agent-b", "done"));
      overlay.selectedIndex = 999;

      // Render should still work and show both agents.
      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("agent-a");
      expect(joined).toContain("agent-b");
      // No ▶ since selectedIndex is out of range.
      expect(joined).not.toContain("▶");
    });
  });

  describe("clearMemory", () => {
    it("clears agents but preserves lastLines after pushStreamEvent", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });

      overlay.clearMemory();

      expect(overlay.entryCount).toBe(0);
      // lastLines are NOT cleared by clearMemory — they persist.
      expect(overlay.getLastStreamLine("builder")).toBe("tool_use: read");
      expect(overlay.lastStreamLine).toBe("tool_use: read");
    });
  });

  describe("pushStreamEvent", () => {
    it("pushes event for an agent not yet added via update", () => {
      const overlay = makeOverlay();

      overlay.pushStreamEvent("unknown-agent", { type: "tool_use", tool: "read" });

      expect(overlay.getLastStreamLine("unknown-agent")).toBe("tool_use: read");
      expect(overlay.lastStreamLine).toBe("tool_use: read");
    });

    it("requests render even when no disk write happens", () => {
      const tui = makeTui();
      const overlay = makeOverlay(tui);

      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });

      expect(tui.requestRender).toHaveBeenCalled();
    });

    it("handles pushStreamEvent with streamDir set but empty executionId gracefully", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-empty-exec-stream-"));
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("", tmpDir);

      // Should not throw.
      expect(() => {
        overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });
      }).not.toThrow();

      expect(overlay.getLastStreamLine("builder")).toBe("tool_use: read");

      overlay.dispose();
    });
  });

  describe("formatStreamEvent edge cases", () => {
    it("formats tool_result with array content where first element lacks text", () => {
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "tool_result",
        content: [{ notText: true }],
      });
      expect(line).toBe("tool_result");
    });

    it("formats tool_result with empty array content", () => {
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "tool_result",
        content: [],
      });
      expect(line).toBe("tool_result");
    });

    it("formats tool_result with text block array content", () => {
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "tool_result",
        content: [{ text: "File content here", type: "text" }],
      });
      expect(line).toBe("tool_result: File content here");
    });

    it("formats events with non-string type field", () => {
      const line = AgentViewerOverlay.formatStreamEvent({ type: 123 });
      expect(line).toBe("unknown");
    });

    it("formats tool_use with missing tool field", () => {
      const line = AgentViewerOverlay.formatStreamEvent({ type: "tool_use" });
      expect(line).toBe("tool_use");
    });

    it("formats message_start with missing role field", () => {
      const line = AgentViewerOverlay.formatStreamEvent({ type: "message_start" });
      expect(line).toBe("message_start");
    });

    it("formats assistant with missing text field", () => {
      const line = AgentViewerOverlay.formatStreamEvent({ type: "assistant" });
      expect(line).toBe("assistant");
    });
  });

  describe("getStreamTail edge cases", () => {
    it("handles read errors gracefully", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-stream-test-"));
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("exec-1", tmpDir);
      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });

      // Remove the stream file to force a read error.
      const filePath = join(tmpDir, "exec-1-builder.stream");
      rmSync(filePath);

      const tail = overlay.getStreamTail("builder");
      expect(tail).toBe("");

      overlay.dispose();
    });
  });

  describe("constructor with streamDir (via setAgentExecutionId)", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "forge-overlay-test-"));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("writes stream events to disk and provides readable tail", () => {
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("exec-1", tmpDir);

      overlay.pushStreamEvent("builder", { type: "message_start", role: "assistant" });
      overlay.pushStreamEvent("builder", { type: "assistant", text: "I will now read the file." });
      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });

      const tail = overlay.getStreamTail("builder");
      expect(tail).toContain("message_start: assistant");
      expect(tail).toContain("assistant: I will now read the file.");
      expect(tail).toContain("tool_use: read");

      overlay.dispose();
    });

    it("stream file content survives overlay instance lifetime", () => {
      const overlay1 = makeOverlay();
      overlay1.setAgentExecutionId("exec-1", tmpDir);
      overlay1.pushStreamEvent("builder", { type: "tool_use", tool: "read" });

      const overlay2 = makeOverlay();
      overlay2.setAgentExecutionId("exec-1", tmpDir);
      overlay2.pushStreamEvent("builder", { type: "tool_use", tool: "write" });

      const tail = overlay2.getStreamTail("builder");
      // The tail shows lines written via overlay2.
      expect(tail).toContain("tool_use: write");

      overlay1.dispose();
      overlay2.dispose();
    });
  });
});
