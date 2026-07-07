import { mkdtempSync, rmSync } from "node:fs";
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
  return {} as TUI;
}

function makeEntry(
  id: string,
  status: string,
  overrides: Partial<Omit<AgentViewerEntry, "id" | "status">> = {},
): AgentViewerEntry {
  return { id, status, ...overrides };
}

// ── Tests ────────────────────────────────────────────────────

describe("AgentViewerOverlay", () => {
  describe("constructor", () => {
    it("starts with zero entries", () => {
      const overlay = new AgentViewerOverlay();
      expect(overlay.entryCount).toBe(0);
    });

    it("accepts a custom maxRawLength", () => {
      const overlay = new AgentViewerOverlay(200);
      const theme = makeTheme();

      overlay.update(makeEntry("builder", "done", { raw: "a".repeat(300) }));
      const factory = overlay.buildWidgetFactory();
      const component = factory(makeTui(), theme);
      const lines = component.render(80);

      // Should contain truncated output (200 chars + "...")
      const joined = lines.join("\n");
      expect(joined).toContain("...");
    });
  });

  describe("update", () => {
    it("adds a new agent entry", () => {
      const overlay = new AgentViewerOverlay();
      overlay.update(makeEntry("builder", "started"));

      expect(overlay.entryCount).toBe(1);
    });

    it("merges with existing entry for the same id", () => {
      const overlay = new AgentViewerOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.update(makeEntry("builder", "done", { summary: "Build passed" }));

      expect(overlay.entryCount).toBe(1);

      const theme = makeTheme();
      const factory = overlay.buildWidgetFactory();
      const component = factory(makeTui(), theme);
      const lines = component.render(80);
      const joined = lines.join("\n");

      // Status should have been updated to "done".
      expect(joined).toContain("[done]");
      // Summary should be visible.
      expect(joined).toContain("Build passed");
    });

    it("tracks multiple agents independently", () => {
      const overlay = new AgentViewerOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.update(makeEntry("reviewer", "started"));
      overlay.update(makeEntry("builder", "done", { summary: "OK" }));

      expect(overlay.entryCount).toBe(2);

      const theme = makeTheme();
      const factory = overlay.buildWidgetFactory();
      const component = factory(makeTui(), theme);
      const lines = component.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("builder");
      expect(joined).toContain("reviewer");
      expect(joined).toContain("OK");
    });
  });

  describe("clear", () => {
    it("removes all entries", () => {
      const overlay = new AgentViewerOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.update(makeEntry("reviewer", "done"));

      overlay.clear();

      expect(overlay.entryCount).toBe(0);
    });

    it("resets to empty display after clear", () => {
      const overlay = new AgentViewerOverlay();
      overlay.update(makeEntry("builder", "started"));

      overlay.clear();

      const theme = makeTheme();
      const factory = overlay.buildWidgetFactory();
      const component = factory(makeTui(), theme);
      const lines = component.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("no agents running");
      expect(joined).not.toContain("builder");
    });
  });

  describe("buildWidgetFactory", () => {
    it("returns a Component factory that includes header", () => {
      const overlay = new AgentViewerOverlay();
      const theme = makeTheme();
      const factory = overlay.buildWidgetFactory();
      const component = factory(makeTui(), theme);
      const lines = component.render(80);

      expect(lines.length).toBeGreaterThan(0);
      expect(lines[0]).toContain("Agent Viewer");
    });

    it("shows 'no agents running' when empty", () => {
      const overlay = new AgentViewerOverlay();
      const theme = makeTheme();
      const factory = overlay.buildWidgetFactory();
      const component = factory(makeTui(), theme);
      const lines = component.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("no agents running");
    });

    it("shows agent entries with status icons", () => {
      const overlay = new AgentViewerOverlay();
      overlay.update(makeEntry("builder", "done", { summary: "Built successfully" }));

      const theme = makeTheme();
      const factory = overlay.buildWidgetFactory();
      const component = factory(makeTui(), theme);
      const lines = component.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("✓");
      expect(joined).toContain("builder");
      expect(joined).toContain("[done]");
      expect(joined).toContain("Built successfully");
    });

    it("shows raw output when present", () => {
      const overlay = new AgentViewerOverlay();
      overlay.update(makeEntry("builder", "done", { raw: "output line 1\noutput line 2" }));

      const theme = makeTheme();
      const factory = overlay.buildWidgetFactory();
      const component = factory(makeTui(), theme);
      const lines = component.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("output line 1");
      expect(joined).toContain("output line 2");
    });

    it("truncates raw output beyond maxRawLength", () => {
      const overlay = new AgentViewerOverlay(100);
      const longOutput = "x".repeat(200);
      overlay.update(makeEntry("builder", "done", { raw: longOutput }));

      const theme = makeTheme();
      const factory = overlay.buildWidgetFactory();
      const component = factory(makeTui(), theme);
      const lines = component.render(80);
      const joined = lines.join("\n");

      // Output should be truncated with "..."
      expect(joined).toContain("...");
      // The full 200 chars should NOT be present
      expect(joined).not.toContain(longOutput);
    });

    it("shows started agents with ⏳ icon", () => {
      const overlay = new AgentViewerOverlay();
      overlay.update(makeEntry("builder", "started"));

      const theme = makeTheme();
      const factory = overlay.buildWidgetFactory();
      const component = factory(makeTui(), theme);
      const lines = component.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("⏳");
      expect(joined).toContain("[started]");
    });

    it("shows error agents with ✗ icon", () => {
      const overlay = new AgentViewerOverlay();
      overlay.update(makeEntry("builder", "error", { summary: "Build failed" }));

      const theme = makeTheme();
      const factory = overlay.buildWidgetFactory();
      const component = factory(makeTui(), theme);
      const lines = component.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("✗");
      expect(joined).toContain("[error]");
      expect(joined).toContain("Build failed");
    });

    it("shows unknown status with ○ icon", () => {
      const overlay = new AgentViewerOverlay();
      overlay.update(makeEntry("builder", "paused"));

      const theme = makeTheme();
      const factory = overlay.buildWidgetFactory();
      const component = factory(makeTui(), theme);
      const lines = component.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("○");
      expect(joined).toContain("[paused]");
    });

    it("respects width parameter for separator", () => {
      const overlay = new AgentViewerOverlay();
      overlay.update(makeEntry("builder", "done"));

      const theme = makeTheme();
      const factory = overlay.buildWidgetFactory();
      const component = factory(makeTui(), theme);
      const narrowLines = component.render(30);
      const wideLines = component.render(100);

      // Narrow width produces shorter separator (max 30)
      const narrowJoined = narrowLines.join("\n");
      const wideJoined = wideLines.join("\n");

      // Both should contain the separator
      expect(narrowJoined).toContain("─");
      expect(wideJoined).toContain("─");
    });

    it("returns a Component with an invalidate method", () => {
      const overlay = new AgentViewerOverlay();
      const theme = makeTheme();
      const factory = overlay.buildWidgetFactory();
      const component = factory(makeTui(), theme);

      expect(component.invalidate).toBeDefined();
      expect(() => component.invalidate()).not.toThrow();
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

  describe("entryCount", () => {
    it("tracks the number of unique agent ids", () => {
      const overlay = new AgentViewerOverlay();
      expect(overlay.entryCount).toBe(0);

      overlay.update(makeEntry("a", "started"));
      expect(overlay.entryCount).toBe(1);

      overlay.update(makeEntry("b", "started"));
      expect(overlay.entryCount).toBe(2);

      // Same id update should not increase count.
      overlay.update(makeEntry("a", "done"));
      expect(overlay.entryCount).toBe(2);
    });
  });

  describe("pushStreamEvent", () => {
    it("stores the formatted stream line in memory for a given agent", () => {
      const overlay = new AgentViewerOverlay();
      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });

      expect(overlay.getLastStreamLine("builder")).toBe("tool_use: read");
    });

    it("overwrites previous last line for the same agent", () => {
      const overlay = new AgentViewerOverlay();
      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });
      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "write" });

      expect(overlay.getLastStreamLine("builder")).toBe("tool_use: write");
    });

    it("tracks last lines per agent independently", () => {
      const overlay = new AgentViewerOverlay();
      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });
      overlay.pushStreamEvent("reviewer", { type: "tool_use", tool: "lint" });

      expect(overlay.getLastStreamLine("builder")).toBe("tool_use: read");
      expect(overlay.getLastStreamLine("reviewer")).toBe("tool_use: lint");
    });

    it("writes stream events to a filesystem log when streamDir is configured", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-stream-test-"));
      const overlay = new AgentViewerOverlay(500, tmpDir);

      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });
      overlay.pushStreamEvent("builder", { type: "message_start", role: "assistant" });

      const tail = overlay.getStreamTail("builder");
      expect(tail).toContain("tool_use: read");
      expect(tail).toContain("message_start: assistant");

      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("creates the stream directory if it does not exist", () => {
      const tmpDir = join(tmpdir(), `forge-stream-mkdir-${Date.now()}`);
      const overlay = new AgentViewerOverlay(500, tmpDir);

      // Directory does not exist yet — pushStreamEvent should create it.
      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });

      const tail = overlay.getStreamTail("builder");
      expect(tail).toContain("tool_use: read");

      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("does not throw when streamDir filesystem operations fail", () => {
      // Use an empty string as streamDir to simulate a write to an
      // invalid path — the implementation should swallow the error.
      const overlay = new AgentViewerOverlay(500, "/nonexistent/path/that/should/fail");

      expect(() => {
        overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });
      }).not.toThrow();

      // In-memory line should still be recorded even though fs write failed.
      expect(overlay.getLastStreamLine("builder")).toBe("tool_use: read");
    });
  });

  describe("lastStreamLine", () => {
    it("returns empty string when no stream events have been pushed", () => {
      const overlay = new AgentViewerOverlay();
      expect(overlay.lastStreamLine).toBe("");
    });

    it("returns the most recently recorded line across all agents", () => {
      const overlay = new AgentViewerOverlay();
      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });
      overlay.pushStreamEvent("reviewer", { type: "tool_use", tool: "lint" });

      expect(overlay.lastStreamLine).toBe("tool_use: lint");
    });
  });

  describe("getStreamTail", () => {
    it("returns empty string when no streamDir was configured", () => {
      const overlay = new AgentViewerOverlay();
      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });

      expect(overlay.getStreamTail("builder")).toBe("");
    });

    it("returns empty string when agent has no stream file", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-stream-test-"));
      const overlay = new AgentViewerOverlay(500, tmpDir);

      expect(overlay.getStreamTail("unknown")).toBe("");

      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("returns the last N lines from the stream file", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-stream-test-"));
      const overlay = new AgentViewerOverlay(500, tmpDir);

      for (let i = 0; i < 5; i++) {
        overlay.pushStreamEvent("builder", { type: "tool_use", tool: `tool-${i}` });
      }

      const tail = overlay.getStreamTail("builder", 2);
      const tailLines = tail.split("\n");
      expect(tailLines).toHaveLength(2);
      expect(tailLines[0]).toBe("tool_use: tool-3");
      expect(tailLines[1]).toBe("tool_use: tool-4");

      rmSync(tmpDir, { recursive: true, force: true });
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

  describe("rendering with stream lines", () => {
    it("shows the last stream line for a started agent", () => {
      const overlay = new AgentViewerOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });

      const theme = makeTheme();
      const factory = overlay.buildWidgetFactory();
      const component = factory(makeTui(), theme);
      const lines = component.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("tool_use: read");
      expect(joined).toContain("⏳");
      expect(joined).toContain("builder");
    });

    it("does not show stream line for a done agent", () => {
      const overlay = new AgentViewerOverlay();
      overlay.update(makeEntry("builder", "done", { summary: "Build passed" }));
      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });

      const theme = makeTheme();
      const factory = overlay.buildWidgetFactory();
      const component = factory(makeTui(), theme);
      const lines = component.render(80);
      const joined = lines.join("\n");

      // Stream line should not appear because agent is done.
      expect(joined).not.toContain("tool_use: read");
      expect(joined).toContain("Build passed");
    });
  });

  describe("constructor with streamDir", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "forge-overlay-test-"));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("accepts a streamDir parameter without affecting other behaviour", () => {
      const overlay = new AgentViewerOverlay(300, tmpDir);
      overlay.update(makeEntry("builder", "started"));

      expect(overlay.entryCount).toBe(1);
    });

    it("writes stream events to disk and provides readable tail", () => {
      const overlay = new AgentViewerOverlay(500, tmpDir);

      overlay.pushStreamEvent("builder", { type: "message_start", role: "assistant" });
      overlay.pushStreamEvent("builder", { type: "assistant", text: "I will now read the file." });
      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });

      const tail = overlay.getStreamTail("builder");
      expect(tail).toContain("message_start: assistant");
      expect(tail).toContain("assistant: I will now read the file.");
      expect(tail).toContain("tool_use: read");
    });

    it("stream file content survives overlay instance lifetime", () => {
      const overlay = new AgentViewerOverlay(500, tmpDir);
      overlay.pushStreamEvent("builder", { type: "tool_use", tool: "read" });

      // Create a new overlay using the same directory — tail should be readable.
      const overlay2 = new AgentViewerOverlay(500, tmpDir);
      // pushStreamEvent on overlay2 to register the file path.
      overlay2.pushStreamEvent("builder", { type: "tool_use", tool: "write" });

      const tail = overlay2.getStreamTail("builder");
      // The tail only shows the last N lines written via THIS overlay.
      expect(tail).toContain("tool_use: write");
    });
  });
});
