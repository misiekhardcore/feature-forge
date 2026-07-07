import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentViewerEntry } from "./AgentViewerOverlay";
import { AgentViewerOverlay } from "./AgentViewerOverlay";

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
      expect(() => overlay.handleInput("up")).not.toThrow();
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
  });

  describe("handleInput", () => {
    describe("list view", () => {
      it("calls onDone when escape is pressed", () => {
        const done = vi.fn();
        const overlay = makeOverlay(undefined, undefined, done);

        overlay.handleInput("escape");

        expect(done).toHaveBeenCalledOnce();
      });

      it("calls onDone when esc is pressed", () => {
        const done = vi.fn();
        const overlay = makeOverlay(undefined, undefined, done);

        overlay.handleInput("esc");

        expect(done).toHaveBeenCalledOnce();
      });

      it("navigates down with down key", () => {
        const tui = makeTui();
        const overlay = makeOverlay(tui);
        overlay.update(makeEntry("a", "started"));
        overlay.update(makeEntry("b", "started"));
        overlay.update(makeEntry("c", "started"));

        expect(overlay.selectedIndex).toBe(0);

        overlay.handleInput("down");
        expect(overlay.selectedIndex).toBe(1);
        expect(tui.requestRender).toHaveBeenCalled();

        overlay.handleInput("down");
        expect(overlay.selectedIndex).toBe(2);

        overlay.handleInput("down");
        expect(overlay.selectedIndex).toBe(0);
      });

      it("navigates up with up key", () => {
        const tui = makeTui();
        const overlay = makeOverlay(tui);
        overlay.update(makeEntry("a", "started"));
        overlay.update(makeEntry("b", "started"));
        overlay.update(makeEntry("c", "started"));

        expect(overlay.selectedIndex).toBe(0);

        overlay.handleInput("up");
        expect(overlay.selectedIndex).toBe(2);
        expect(tui.requestRender).toHaveBeenCalled();
      });

      it("does nothing on up/down when no agents exist", () => {
        const tui = makeTui();
        const overlay = makeOverlay(tui);

        overlay.handleInput("up");
        overlay.handleInput("down");

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
        overlay.handleInput("enter");

        expect(overlay.viewMode).toBe("detail");
        expect(overlay.selectedAgentId).toBe("reviewer");
        expect(overlay.scrollOffset).toBe(0);
        expect(tui.requestRender).toHaveBeenCalled();
      });

      it("switches to detail view on return key", () => {
        const tui = makeTui();
        const overlay = makeOverlay(tui);
        overlay.update(makeEntry("builder", "started"));

        overlay.handleInput("return");

        expect(overlay.viewMode).toBe("detail");
        expect(overlay.selectedAgentId).toBe("builder");
      });

      it("does nothing on enter when no agents exist", () => {
        const tui = makeTui();
        const overlay = makeOverlay(tui);

        overlay.handleInput("enter");

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

        overlay.handleInput("escape");

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

        overlay.handleInput("up");

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

        overlay.handleInput("up");

        expect(overlay.scrollOffset).toBe(0);
      });

      it("scrolls down with down key", () => {
        const tui = makeTui();
        const overlay = makeOverlay(tui);
        overlay.update(makeEntry("builder", "started"));
        overlay.viewMode = "detail";
        overlay.selectedAgentId = "builder";
        overlay.scrollOffset = 0;

        overlay.handleInput("down");

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
        for (let i = 0; i < 6; i++) overlay.handleInput("down");

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
        for (let i = 0; i < 4; i++) overlay.handleInput("up");

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
        overlay.handleInput("up");

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
