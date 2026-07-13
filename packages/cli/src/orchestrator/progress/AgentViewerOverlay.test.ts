import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { MarkdownTheme, TUI } from "@earendil-works/pi-tui";
import { AgentStatus } from "@feature-forge/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Agent } from "../../agents/agents/Agent";
import type { AgentSpecification } from "../../agents/specifications";
import type { AgentSupervisor } from "../../agents/supervisors/AgentSupervisor";
import { makeMockEventBus } from "../../test-utils";
import type { AgentViewerEntry, AgentViewerOverlayParams } from "./AgentViewerOverlay";
import { AgentViewerOverlay } from "./AgentViewerOverlay";
import { StreamHelpers } from "./StreamHelpers";

// ── Helpers ──────────────────────────────────────────────────

function makeTheme(): Theme {
  return {
    fg: vi.fn((_color: string, text: string) => text),
    bold: vi.fn((text: string) => text),
    italic: vi.fn((text: string) => text),
    inverse: vi.fn((text: string) => text),
    bg: vi.fn((_color: string, text: string) => text),
  } as unknown as Theme;
}

function makeMarkdownTheme(): MarkdownTheme {
  return {} as MarkdownTheme;
}

function makeTui(): TUI {
  return {
    requestRender: vi.fn(),
  } as unknown as TUI;
}

function makeEntry(
  id: string,
  status: string,
  overrides: Partial<Omit<AgentViewerEntry, "id" | "status">> = {},
): AgentViewerEntry {
  return { id, status, ...overrides };
}

function makeOverlay(tui?: TUI, theme?: Theme, onDone?: () => void): AgentViewerOverlay {
  return new AgentViewerOverlay({
    tui: tui ?? makeTui(),
    theme: theme ?? makeTheme(),
    onDone: onDone ?? vi.fn(),
    cwd: "/tmp",
    markdownTheme: makeMarkdownTheme(),
  } satisfies AgentViewerOverlayParams);
}

function makeStreamDir(): string {
  return mkdtempSync(join(tmpdir(), "forge-overlay-test-"));
}

// ── Tests ────────────────────────────────────────────────────

describe("AgentViewerOverlay", () => {
  describe("constructor", () => {
    it("starts with zero entries", () => {
      const overlay = makeOverlay();
      expect(overlay.entryCount).toBe(0);
    });

    it("accepts params object with tui, theme, onDone, cwd, markdownTheme", () => {
      const tui = makeTui();
      const theme = makeTheme();
      const onDone = vi.fn();
      const overlay = new AgentViewerOverlay({
        tui,
        theme,
        onDone,
        cwd: "/tmp",
        markdownTheme: makeMarkdownTheme(),
      });

      expect(overlay.entryCount).toBe(0);
    });

    it("starts in list view mode with no selection", () => {
      const overlay = makeOverlay();

      expect(overlay.viewMode).toBe("list");
      expect(overlay.selectedIndex).toBe(0);
      expect(overlay.selectedAgentId).toBeUndefined();
    });
  });

  describe("Component interface", () => {
    it("implements render", () => {
      const overlay = makeOverlay();
      const lines = overlay.render(80);

      expect(lines).toBeInstanceOf(Array);
      expect(lines.length).toBeGreaterThan(0);
    });

    it("produces the same output after invalidate as before", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));

      const before = overlay.render(80);
      overlay.invalidate();
      const after = overlay.render(80);

      expect(after).toEqual(before);
    });

    it("invalidate does not throw on a fresh overlay with no state", () => {
      const overlay = makeOverlay();

      expect(() => overlay.invalidate()).not.toThrow();
    });
  });

  describe("render", () => {
    it("shows header", () => {
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

    it("shows agent entries with status icons", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "done", { summary: "Built successfully" }));

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("✓");
      expect(joined).toContain("builder");
      expect(joined).toContain("Built successfully");
    });

    it("shows ✗ instead of ✓ when passed is false", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("reviewer", "done", { passed: false, summary: "Review failed" }));

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("✗");
      expect(joined).not.toContain("✓");
    });

    it("shows raw output when present", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "done", { raw: "output line 1\noutput line 2" }));

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("output line 1");
      expect(joined).toContain("output line 2");
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

    it("shows last stream line for started agents", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("tool_execution_start: read");
      expect(joined).toContain("⏳");
    });

    it("shows stream line for done agents", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "done", { summary: "Build passed" }));
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("tool_execution_start: read");
      expect(joined).toContain("Build passed");
    });

    it("truncates long last stream line to fit width", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      const longLine = "x".repeat(100);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: longLine,
      } as AgentEvent);

      const lines = overlay.render(40);
      const joined = lines.join("\n");

      // Should be truncated to fit within width 40 minus 4-space indent.
      expect(joined).toContain("tool_execution_start");
      expect(joined).toContain("xxx");
      expect(joined).toContain("...");
      // The full long line should not appear.
      expect(joined).not.toContain(longLine);
    });

    it("does not truncate short last stream lines", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      const shortLine = "tool_execution_start: read";
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain(shortLine);
      expect(joined).not.toContain("...");
    });

    it("shows both summary and raw output together", () => {
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

      expect(joined).toContain("✓");
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

    it("resets to empty display after clearMemory", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));

      overlay.clearMemory();

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("no agents running");
      expect(joined).not.toContain("builder");
    });

    it("clears agents but preserves lastLines after pushStreamEvent", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      overlay.clearMemory();

      expect(overlay.entryCount).toBe(0);
      // lastLines are NOT cleared by clearMemory — they persist.
      expect(overlay.getLastStreamLine("builder")).toBe("tool_execution_start: read");
      expect(overlay.lastStreamLine).toBe("tool_execution_start: read");
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

  describe("statusIcon (via getStatusIcon helper)", () => {
    it("returns ✓ for done with passed: true", () => {
      expect(StreamHelpers.getStatusIcon("done", true)).toEqual({ char: "✓", color: "success" });
    });

    it("returns ✓ for done without explicit passed", () => {
      expect(StreamHelpers.getStatusIcon("done")).toEqual({ char: "✓", color: "success" });
    });

    it("returns ✗ for done with passed: false", () => {
      expect(StreamHelpers.getStatusIcon("done", false)).toEqual({ char: "✗", color: "error" });
    });

    it("returns ⏳ for started", () => {
      expect(StreamHelpers.getStatusIcon("started")).toEqual({ char: "⏳", color: "warning" });
    });

    it("returns ✗ for error", () => {
      expect(StreamHelpers.getStatusIcon("error")).toEqual({ char: "✗", color: "error" });
    });

    it("returns ○ for unknown status", () => {
      expect(StreamHelpers.getStatusIcon("paused")).toEqual({ char: "○", color: "muted" });
    });
  });

  describe("formatStreamEvent", () => {
    it("formats tool_execution_start events as 'tool_execution_start: <toolName>'", () => {
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "tool_execution_start",
        toolName: "read",
      });
      expect(line).toBe("tool_execution_start: read");
    });

    it("formats tool_execution_end with ok status", () => {
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "tool_execution_end",
        toolName: "tool",
        result: "some output",
        isError: false,
      });
      expect(line).toBe("tool_execution_end: tool (ok)");
    });

    it("formats tool_execution_end with error status", () => {
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "tool_execution_end",
        toolName: "tool",
        isError: true,
      });
      expect(line).toBe("tool_execution_end: tool (error)");
    });

    it("formats message_start with nested message role", () => {
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "message_start",
        message: { role: "assistant" },
      });
      expect(line).toBe("message_start: assistant");
    });

    it("formats message_end with content text blocks", () => {
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Here is the result." }],
        },
      });
      expect(line).toBe("message_end: Here is the result.");
    });

    it("formats agent_start as 'started'", () => {
      const line = AgentViewerOverlay.formatStreamEvent({ type: "agent_start" });
      expect(line).toBe("agent_start: started");
    });

    it("formats agent_end as 'completed'", () => {
      const line = AgentViewerOverlay.formatStreamEvent({ type: "agent_end" });
      expect(line).toBe("agent_end: completed");
    });

    it("formats turn_start and turn_end", () => {
      expect(AgentViewerOverlay.formatStreamEvent({ type: "turn_start" })).toBe(
        "turn_start: turn start",
      );
      expect(AgentViewerOverlay.formatStreamEvent({ type: "turn_end" })).toBe("turn_end: turn end");
    });

    it("formats tool_execution_update with partial result", () => {
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "tool_execution_update",
        toolName: "read",
        partialResult: "Reading file...",
      });
      expect(line).toBe("tool_execution_update: read: Reading file...");
    });

    it("formats message_update with content text", () => {
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "message_update",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "I am thinking..." }],
        },
      });
      expect(line).toBe("message_update: I am thinking...");
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

    it("formats events with non-string type field", () => {
      const line = AgentViewerOverlay.formatStreamEvent({ type: 123 });
      expect(line).toBe("unknown");
    });

    it("formats tool_execution_start with missing toolName", () => {
      const line = AgentViewerOverlay.formatStreamEvent({ type: "tool_execution_start" });
      expect(line).toBe("tool_execution_start");
    });

    it("formats message_start with missing message field", () => {
      const line = AgentViewerOverlay.formatStreamEvent({ type: "message_start" });
      expect(line).toBe("message_start");
    });

    it("formats message_end with missing message field", () => {
      const line = AgentViewerOverlay.formatStreamEvent({ type: "message_end" });
      expect(line).toBe("message_end");
    });
  });

  describe("pushStreamEvent", () => {
    it("stores the formatted stream line in memory for a given agent", () => {
      const overlay = makeOverlay();
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      expect(overlay.getLastStreamLine("builder")).toBe("tool_execution_start: read");
    });

    it("overwrites previous last line for the same agent", () => {
      const overlay = makeOverlay();
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "write",
      } as AgentEvent);

      expect(overlay.getLastStreamLine("builder")).toBe("tool_execution_start: write");
    });

    it("tracks last lines per agent independently", () => {
      const overlay = makeOverlay();
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      overlay.pushStreamEvent("reviewer", {
        type: "tool_execution_start",
        toolName: "lint",
      } as AgentEvent);

      expect(overlay.getLastStreamLine("builder")).toBe("tool_execution_start: read");
      expect(overlay.getLastStreamLine("reviewer")).toBe("tool_execution_start: lint");
    });

    it("writes stream events to a filesystem log when streamDir is configured", () => {
      const tmpDir = makeStreamDir();
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as AgentEvent);

      const filePath = join(tmpDir, "builder.stream");
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("tool_execution_start: read");
      expect(content).toContain("message_start: assistant");

      overlay.dispose();
    });

    it("writes ALL raw events as JSONL to disk when streamDir is configured", () => {
      const tmpDir = makeStreamDir();
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "write",
      } as AgentEvent);

      const eventsFilePath = join(tmpDir, "builder.events.jsonl");
      expect(existsSync(eventsFilePath)).toBe(true);
      const content = readFileSync(eventsFilePath, "utf-8").trim();
      const lines = content.split("\n");
      expect(lines).toHaveLength(2);

      const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
      expect(parsed[0].type).toBe("tool_execution_start");
      expect(parsed[0].toolName).toBe("read");
      expect(parsed[1].toolName).toBe("write");

      overlay.dispose();
    });

    it("tracks events via getConversation", () => {
      const overlay = makeOverlay();

      // Push events and verify getConversation returns correct count
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "write",
      } as AgentEvent);

      const events = overlay.getConversation("builder");
      expect(events).toHaveLength(2);
    });

    it("does not write to disk when streamDir is not set", () => {
      const overlay = makeOverlay();

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      // In-memory line should still be recorded.
      expect(overlay.getLastStreamLine("builder")).toBe("tool_execution_start: read");
    });

    it("creates the stream directory if it does not exist", () => {
      const tmpDir = join(tmpdir(), `forge-stream-mkdir-${Date.now()}`);
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      const filePath = join(tmpDir, "builder.stream");
      expect(existsSync(filePath)).toBe(true);

      overlay.dispose();
    });

    it("does not throw when streamDir filesystem operations fail", () => {
      const overlay = makeOverlay();
      overlay.setStreamDir("/nonexistent/path/that/should/fail");

      expect(() => {
        overlay.pushStreamEvent("builder", {
          type: "tool_execution_start",
          toolName: "read",
        } as AgentEvent);
      }).not.toThrow();

      expect(overlay.getLastStreamLine("builder")).toBe("tool_execution_start: read");

      overlay.dispose();
    });

    it("pushes event for an agent not yet added via update", () => {
      const overlay = makeOverlay();

      overlay.pushStreamEvent("unknown-agent", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      expect(overlay.getLastStreamLine("unknown-agent")).toBe("tool_execution_start: read");
      expect(overlay.lastStreamLine).toBe("tool_execution_start: read");
    });

    it("requests render when pushing an event", () => {
      const tui = makeTui();
      const overlay = makeOverlay(tui);

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      expect(tui.requestRender).toHaveBeenCalled();
    });

    it("enforces sliding window buffer limit", () => {
      const overlay = makeOverlay();

      // Push STREAM_EVENT_BUFFER_MAX + 10 events
      const maxEvents = AgentViewerOverlay.STREAM_EVENT_BUFFER_MAX;
      for (let i = 0; i < maxEvents + 10; i++) {
        overlay.pushStreamEvent("builder", {
          type: "tool_execution_start",
          toolName: `tool-${i}`,
        } as AgentEvent);
      }

      // In-memory buffer should be capped at maxEvents
      const events = overlay.getConversation("builder");
      expect(events).toHaveLength(maxEvents);
      // First event in buffer should be tool-10 (oldest 10 were evicted)
      expect((events[0] as Record<string, unknown>).toolName).toBe("tool-10");
      // Last event should be tool-209
      expect((events[maxEvents - 1] as Record<string, unknown>).toolName).toBe(
        `tool-${maxEvents + 9}`,
      );
    });

    it("skips noisy events in stream file (message_update, turn_start, turn_end)", () => {
      const tmpDir = makeStreamDir();
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      overlay.pushStreamEvent("builder", {
        type: "message_update",
        message: { role: "assistant", content: [{ type: "text", text: "thinking..." }] },
      } as AgentEvent);
      overlay.pushStreamEvent("builder", { type: "turn_start" });
      overlay.pushStreamEvent("builder", { type: "turn_end" });

      // All should be in the JSONL file but NOT in the .stream file
      // (stream file only has non-noisy events).
      const streamFile = join(tmpDir, "builder.stream");
      const eventsFile = join(tmpDir, "builder.events.jsonl");
      expect(existsSync(streamFile)).toBe(false); // nothing written
      expect(existsSync(eventsFile)).toBe(true); // all events written as JSONL

      overlay.dispose();
    });

    it("skips message_end with empty text in stream file", () => {
      const tmpDir = makeStreamDir();
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: { role: "assistant", content: [] },
      } as unknown as AgentEvent);

      // message_end with no text should not be in stream file
      const streamFile = join(tmpDir, "builder.stream");
      expect(existsSync(streamFile)).toBe(false);

      overlay.dispose();
    });
  });

  describe("getConversation", () => {
    it("returns the in-memory buffer for an agent", () => {
      const overlay = makeOverlay();
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      const events = overlay.getConversation("builder");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("tool_execution_start");
    });

    it("returns empty array for unknown agent", () => {
      const overlay = makeOverlay();
      expect(overlay.getConversation("unknown")).toEqual([]);
    });
  });

  describe("loadConversationEvents", () => {
    it("loads events from .events.jsonl on disk", () => {
      const tmpDir = makeStreamDir();
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "write",
      } as AgentEvent);

      // Load from disk via getAllEventsForConversation (public path: getConversation for in-memory,
      // loadConversationEvents for testing disk reads directly)
      const loaded = overlay.loadConversationEvents("builder", 0, 2);
      expect(loaded).toHaveLength(2);
      expect(loaded[0].type).toBe("tool_execution_start");
      expect((loaded[0] as Record<string, unknown>).toolName).toBe("read");

      overlay.dispose();
    });

    it("returns empty array when streamDir is not set", () => {
      const overlay = makeOverlay();
      expect(overlay.loadConversationEvents("builder", 0, 10)).toEqual([]);
    });

    it("returns empty array for invalid range", () => {
      const overlay = makeOverlay();
      expect(overlay.loadConversationEvents("builder", 5, 3)).toEqual([]);
      expect(overlay.loadConversationEvents("builder", -1, 3)).toEqual([]);
    });

    it("returns empty array when events file does not exist", () => {
      const tmpDir = makeStreamDir();
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      const loaded = overlay.loadConversationEvents("unknown", 0, 10);
      expect(loaded).toEqual([]);

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
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      overlay.pushStreamEvent("reviewer", {
        type: "tool_execution_start",
        toolName: "lint",
      } as AgentEvent);

      expect(overlay.lastStreamLine).toBe("tool_execution_start: lint");
    });
  });

  describe("prepopulateStreamFiles", () => {
    it("discovers existing stream files and creates done entries for unknown agents", () => {
      const tmpDir = makeStreamDir();

      // Write a stream file by pushing an event first
      const overlay1 = makeOverlay();
      overlay1.setStreamDir(tmpDir);
      overlay1.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      overlay1.dispose();

      // A new overlay should discover the file and create a done entry
      const overlay2 = makeOverlay();
      overlay2.prepopulateStreamFiles(tmpDir);

      const lines = overlay2.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("builder");
    });

    it("handles missing directory gracefully", () => {
      const overlay = makeOverlay();
      expect(() => overlay.prepopulateStreamFiles("/nonexistent/dir")).not.toThrow();
    });
  });

  describe("dispose", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = makeStreamDir();
    });

    afterEach(() => {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Directory may already be removed.
      }
    });

    it("clears agent entries on dispose", () => {
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);
      overlay.update(makeEntry("builder", "started"));

      overlay.dispose();

      expect(overlay.entryCount).toBe(0);
    });

    it("is safe to call multiple times", () => {
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      overlay.dispose();
      expect(() => overlay.dispose()).not.toThrow();
    });

    it("does not throw when streamDir was never configured", () => {
      const overlay = makeOverlay();

      expect(() => overlay.dispose()).not.toThrow();
    });

    it("clears lastLines, agentEvents, renderBuffer, and totalEventCount on dispose", () => {
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      expect(overlay.getLastStreamLine("builder")).toBe("tool_execution_start: read");

      overlay.dispose();

      expect(overlay.getLastStreamLine("builder")).toBeUndefined();
      expect(overlay.getConversation("builder")).toEqual([]);
    });
  });

  describe("handleInput", () => {
    it("calls onDone when Escape is pressed in list view", () => {
      const tui = makeTui();
      const onDone = vi.fn();
      const overlay = makeOverlay(tui, undefined, onDone);

      overlay.handleInput("\x1b");

      expect(onDone).toHaveBeenCalledTimes(1);
      expect(tui.requestRender).not.toHaveBeenCalled();
    });

    it("returns to list view when Escape is pressed in detail view", () => {
      const tui = makeTui();
      const onDone = vi.fn();
      const overlay = makeOverlay(tui, undefined, onDone);
      overlay.update(makeEntry("builder", "started"));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      overlay.scrollOffset = 5;
      overlay.autoScroll = true;

      overlay.handleInput("\x1b");

      expect(overlay.viewMode).toBe("list");
      expect(overlay.selectedAgentId).toBeUndefined();
      expect(overlay.scrollOffset).toBe(0);
      expect(overlay.autoScroll).toBe(false);
      expect(tui.requestRender).toHaveBeenCalled();
      expect(onDone).not.toHaveBeenCalled();
    });

    it("navigates down with ArrowDown in list view", () => {
      const tui = makeTui();
      const overlay = makeOverlay(tui);
      overlay.update(makeEntry("agent-a", "started"));
      overlay.update(makeEntry("agent-b", "started"));
      overlay.update(makeEntry("agent-c", "started"));

      overlay.handleInput("\x1b[B");

      expect(overlay.selectedIndex).toBe(1);
      expect(tui.requestRender).toHaveBeenCalled();
    });

    it("wraps around at the bottom with ArrowDown", () => {
      const tui = makeTui();
      const overlay = makeOverlay(tui);
      overlay.update(makeEntry("agent-a", "started"));
      overlay.update(makeEntry("agent-b", "started"));
      overlay.selectedIndex = 1;

      overlay.handleInput("\x1b[B");

      expect(overlay.selectedIndex).toBe(0);
    });

    it("navigates up with ArrowUp in list view", () => {
      const tui = makeTui();
      const overlay = makeOverlay(tui);
      overlay.update(makeEntry("agent-a", "started"));
      overlay.update(makeEntry("agent-b", "started"));
      overlay.selectedIndex = 1;

      overlay.handleInput("\x1b[A");

      expect(overlay.selectedIndex).toBe(0);
      expect(tui.requestRender).toHaveBeenCalled();
    });

    it("wraps around at the top with ArrowUp", () => {
      const tui = makeTui();
      const overlay = makeOverlay(tui);
      overlay.update(makeEntry("agent-a", "started"));
      overlay.update(makeEntry("agent-b", "started"));

      overlay.handleInput("\x1b[A");

      expect(overlay.selectedIndex).toBe(1);
    });

    it("enters detail view on Enter", () => {
      const tui = makeTui();
      const overlay = makeOverlay(tui);
      overlay.update(makeEntry("agent-a", "started"));
      overlay.update(makeEntry("agent-b", "started"));
      overlay.selectedIndex = 1;

      overlay.handleInput("\r");

      expect(overlay.viewMode).toBe("detail");
      expect(overlay.selectedAgentId).toBe("agent-b");
      expect(overlay.autoScroll).toBe(true);
      expect(tui.requestRender).toHaveBeenCalled();
    });

    it("ignores arrow keys when agent list is empty", () => {
      const overlay = makeOverlay();

      overlay.handleInput("\x1b[A");
      overlay.handleInput("\x1b[B");

      expect(overlay.selectedIndex).toBe(0);
    });

    it("ignores Enter when agent list is empty", () => {
      const overlay = makeOverlay();

      overlay.handleInput("\r");

      expect(overlay.viewMode).toBe("list");
      expect(overlay.selectedAgentId).toBeUndefined();
    });

    it("scrolls up in detail view with ArrowUp (disables autoScroll)", () => {
      const tui = makeTui();
      const overlay = makeOverlay(tui);
      overlay.update(makeEntry("builder", "done"));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      overlay.scrollOffset = 3;
      overlay.autoScroll = true;

      overlay.handleInput("\x1b[A");

      expect(overlay.scrollOffset).toBe(2);
      expect(overlay.autoScroll).toBe(false);
      expect(tui.requestRender).toHaveBeenCalled();
    });

    it("does not scroll above zero in detail view", () => {
      const tui = makeTui();
      const overlay = makeOverlay(tui);
      overlay.update(makeEntry("builder", "done"));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      overlay.scrollOffset = 0;

      overlay.handleInput("\x1b[A");

      expect(overlay.scrollOffset).toBe(0);
    });

    it("scrolls down in detail view with ArrowDown", () => {
      const tui = makeTui();
      const overlay = makeOverlay(tui);
      overlay.update(makeEntry("builder", "done"));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      overlay.scrollOffset = 0;

      overlay.handleInput("\x1b[B");

      expect(overlay.scrollOffset).toBe(1);
      expect(tui.requestRender).toHaveBeenCalled();
    });
  });

  describe("renderList with selection", () => {
    it("shows selection cursor on selected agent", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("agent-a", "started"));
      overlay.update(makeEntry("agent-b", "started"));
      overlay.selectedIndex = 1;

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("▶");
      // Only one ▶ should appear (one selected item).
      const cursorCount = (joined.match(/▶/g) || []).length;
      expect(cursorCount).toBe(1);
    });

    it("shows navigation help legend at bottom", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("agent-a", "started"));

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("navigate");
      expect(joined).toContain("view");
      expect(joined).toContain("close");
    });

    it("highlights selected agent id with accent colour", () => {
      const theme = makeTheme();
      const overlay = makeOverlay(undefined, theme);
      overlay.update(makeEntry("agent-a", "started"));
      overlay.update(makeEntry("agent-b", "started"));
      overlay.selectedIndex = 0;

      overlay.render(80);

      // Selected agent id should have been styled with accent.
      expect(theme.fg).toHaveBeenCalledWith("accent", "agent-a");
    });
  });

  describe("renderDetail", () => {
    it("shows agent not found when selectedAgentId is invalid", () => {
      const overlay = makeOverlay();
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "nonexistent";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("agent not found");
    });

    it("shows agent header with status icon in detail view", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "done", { summary: "Build passed" }));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("✓");
      expect(joined).toContain("builder");
      expect(joined).toContain("completed");
    });

    it("shows summary section when present", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "done", { summary: "Build passed" }));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Summary:");
      expect(joined).toContain("Build passed");
    });

    it("shows conversation section in detail view", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "I will now read the file." }],
        },
      } as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Conversation:");
      expect(joined).toContain("I will now read the file");

      overlay.dispose();
    });

    it("shows ✓ icon and completed label when passed is true in detail view", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "done", { passed: true, summary: "Build passed" }));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("✓");
      expect(joined).toContain("completed");
    });

    it("shows ✗ icon and failed label when passed is false in detail view", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("reviewer", "done", { passed: false, summary: "Review failed" }));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "reviewer";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("✗");
      expect(joined).toContain("failed");
    });

    it("dispatches render to renderDetail when viewMode is detail", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "done", { summary: "Build passed" }));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      // Should contain detail-specific content, not list legend.
      expect(joined).toContain("Summary:");
      expect(joined).not.toContain("navigate");
    });
  });

  describe("clearMemory with view state", () => {
    it("resets viewMode, selectedIndex, selectedAgentId, and autoScroll", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      overlay.selectedIndex = 3;
      overlay.scrollOffset = 5;
      overlay.autoScroll = true;

      overlay.clearMemory();

      expect(overlay.viewMode).toBe("list");
      expect(overlay.selectedIndex).toBe(0);
      expect(overlay.selectedAgentId).toBeUndefined();
      expect(overlay.scrollOffset).toBe(0);
      expect(overlay.autoScroll).toBe(false);
    });
  });

  describe("stream file persistence via setStreamDir", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = makeStreamDir();
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("writes stream events to disk and readable via events.jsonl", () => {
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "I will now read the file." }],
        },
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      const filePath = join(tmpDir, "builder.stream");
      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("message_start: assistant");
      expect(content).toContain("message_end: I will now read the file.");
      expect(content).toContain("tool_execution_start: read");

      overlay.dispose();
    });

    it("stream file content survives overlay instance lifetime", () => {
      const overlay1 = makeOverlay();
      overlay1.setStreamDir(tmpDir);
      overlay1.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      overlay1.dispose();

      // Second overlay can still discover the file via prepopulateStreamFiles
      const overlay2 = makeOverlay();
      overlay2.prepopulateStreamFiles(tmpDir);
      const lines = overlay2.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("builder");

      overlay2.dispose();
    });
  });

  describe("agent entry creation via prepopulateStreamFiles", () => {
    it("creates done entries for agents with stream files but not in supervisor", () => {
      const tmpDir = makeStreamDir();

      // Write a stream file via one overlay
      const overlay1 = makeOverlay();
      overlay1.setStreamDir(tmpDir);
      overlay1.pushStreamEvent("completed-agent", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      overlay1.dispose();

      // New overlay discovers the file — creates done entry
      const overlay2 = makeOverlay();
      overlay2.prepopulateStreamFiles(tmpDir);

      const lines = overlay2.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("completed-agent");
      // The entry should have status "done" with summary "Agent completed"
      expect(joined).toContain("Agent completed");

      overlay2.dispose();
    });
  });

  describe("wireOverlayEvents", () => {
    function makeMockAgent(
      id: string,
      role: string,
      status: AgentStatus,
      createdAt: Date = new Date(),
    ): Agent {
      return {
        id,
        status,
        createdAt,
        specification: { role } as AgentSpecification,
        destroy: vi.fn(),
      };
    }

    function makeMockSupervisor(agents: Agent[] = []): AgentSupervisor {
      return {
        getAgent: vi.fn((agentId: string) => agents.find((a) => a.id === agentId)),
        getAllAgents: vi.fn(() => agents),
      } as unknown as AgentSupervisor;
    }

    it("propagates passed: true from agent-done event to the entry", () => {
      const agent = makeMockAgent("builder", "builder", AgentStatus.Completed);
      const supervisor = makeMockSupervisor([agent]);
      const eventBus = makeMockEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        supervisor,
      });

      connect(overlay, "");

      eventBus.emit("feature-forge:agent-done", {
        phase: "agent-done",
        message: 'Agent "builder" completed',
        details: {
          agentId: "builder",
          passed: true,
          summary: "Build passed",
        },
      });

      // Verify the entry was updated with passed: true
      const lines = overlay.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("✓");
      expect(joined).toContain("builder");

      unsubs.forEach((u) => u());
      overlay.dispose();
    });

    it("propagates passed: false from agent-done event to the entry", () => {
      const agent = makeMockAgent("reviewer", "reviewer", AgentStatus.Completed);
      const supervisor = makeMockSupervisor([agent]);
      const eventBus = makeMockEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        supervisor,
      });

      connect(overlay, "");

      eventBus.emit("feature-forge:agent-done", {
        phase: "agent-done",
        message: 'Agent "reviewer" completed',
        details: {
          agentId: "reviewer",
          passed: false,
          summary: "Review failed",
        },
      });

      // The entry should show ✗ for passed: false
      const lines = overlay.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("✗");
      expect(joined).toContain("reviewer");

      unsubs.forEach((u) => u());
      overlay.dispose();
    });

    it("replays buffered events with passed data after connect", () => {
      const agent = makeMockAgent("builder", "builder", AgentStatus.Completed);
      const supervisor = makeMockSupervisor([agent]);
      const eventBus = makeMockEventBus();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        supervisor,
      });

      // Emit events BEFORE connect — they should be buffered.
      eventBus.emit("feature-forge:agent-started", {
        phase: "agent-started",
        message: 'Agent "builder" started',
        details: { agentId: "builder" },
      });
      eventBus.emit("feature-forge:agent-stream", {
        phase: "agent-stream",
        message: 'Agent "builder" stream event',
        details: {
          agentId: "builder",
          event: { type: "tool_execution_start", toolName: "read" },
        },
      });
      eventBus.emit("feature-forge:agent-done", {
        phase: "agent-done",
        message: 'Agent "builder" completed',
        details: {
          agentId: "builder",
          passed: false,
          summary: "Build failed",
        },
      });

      const overlay = makeOverlay();
      connect(overlay, "");

      // After connect, the buffered done event should show ✗.
      const lines = overlay.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("✗");
      expect(joined).toContain("builder");

      unsubs.forEach((u) => u());
      overlay.dispose();
    });

    it("sets passed on entries when initializing from supervisor after connect", () => {
      const agent = makeMockAgent("builder", "builder", AgentStatus.Running);
      const supervisor = makeMockSupervisor([agent]);
      const eventBus = makeMockEventBus();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        supervisor,
      });

      const overlay = makeOverlay();
      connect(overlay, "");

      // The running agent should show ⏳ (no passed concept for started).
      const lines = overlay.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("⏳");

      unsubs.forEach((u) => u());
      overlay.dispose();
    });

    it("ignores events without agentId in details", () => {
      const supervisor = makeMockSupervisor();
      const eventBus = makeMockEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        supervisor,
      });

      connect(overlay, "");

      // Emit an event without agentId — should be silently ignored.
      expect(() => {
        eventBus.emit("feature-forge:agent-done", {
          phase: "agent-done",
          message: "no agent id",
          details: {},
        });
      }).not.toThrow();

      expect(overlay.entryCount).toBe(0);

      unsubs.forEach((u) => u());
      overlay.dispose();
    });

    it("calls pushStreamEvent for stream events after connect", () => {
      const agent = makeMockAgent("builder", "builder", AgentStatus.Running);
      const supervisor = makeMockSupervisor([agent]);
      const eventBus = makeMockEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        supervisor,
      });

      connect(overlay, "");

      eventBus.emit("feature-forge:agent-stream", {
        phase: "agent-stream",
        message: 'Agent "builder" stream event',
        details: {
          agentId: "builder",
          event: { type: "tool_execution_start", toolName: "write" } as AgentEvent,
        },
      });

      expect(overlay.getLastStreamLine("builder")).toBe("tool_execution_start: write");

      unsubs.forEach((u) => u());
      overlay.dispose();
    });

    it("persists stream events to disk when connect sets streamDir", () => {
      const streamDir = makeStreamDir();
      try {
        const agent = makeMockAgent("builder", "builder", AgentStatus.Running);
        const supervisor = makeMockSupervisor([agent]);
        const eventBus = makeMockEventBus();
        const overlay = makeOverlay();

        const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
          eventBus,
          supervisor,
        });

        connect(overlay, streamDir);

        eventBus.emit("feature-forge:agent-stream", {
          phase: "agent-stream",
          message: 'Agent "builder" stream event',
          details: {
            agentId: "builder",
            event: { type: "tool_execution_start", toolName: "read" } as AgentEvent,
          },
        });

        const filePath = join(streamDir, "builder.stream");
        expect(existsSync(filePath)).toBe(true);
        const content = readFileSync(filePath, "utf-8");
        expect(content).toContain("tool_execution_start: read");

        unsubs.forEach((u) => u());
        overlay.dispose();
      } finally {
        rmSync(streamDir, { recursive: true, force: true });
      }
    });
  });

  describe("formatElapsed", () => {
    it("returns seconds for times under 60s", () => {
      const date = new Date(Date.now() - 30_000);
      const result = AgentViewerOverlay.formatElapsed(date);
      expect(result).toBe("30s");
    });

    it("returns minutes and seconds for times under 1h", () => {
      const date = new Date(Date.now() - 125_000);
      const result = AgentViewerOverlay.formatElapsed(date);
      expect(result).toMatch(/^\d+m \d+s$/);
    });

    it("returns hours and minutes for times over 1h", () => {
      const date = new Date(Date.now() - 7_200_000);
      const result = AgentViewerOverlay.formatElapsed(date);
      expect(result).toMatch(/^\d+h \d+m \d+s$/);
    });
  });

  describe("mapStatus", () => {
    it("maps Spawned to started", () => {
      expect(AgentViewerOverlay.mapStatus(AgentStatus.Spawned)).toBe("started");
    });

    it("maps Running to started", () => {
      expect(AgentViewerOverlay.mapStatus(AgentStatus.Running)).toBe("started");
    });

    it("maps Completed to done", () => {
      expect(AgentViewerOverlay.mapStatus(AgentStatus.Completed)).toBe("done");
    });

    it("maps Failed to error", () => {
      expect(AgentViewerOverlay.mapStatus(AgentStatus.Failed)).toBe("error");
    });

    it("maps Cancelled to error", () => {
      expect(AgentViewerOverlay.mapStatus(AgentStatus.Cancelled)).toBe("error");
    });

    it("maps unknown to unknown", () => {
      expect(AgentViewerOverlay.mapStatus("Unknown" as AgentStatus)).toBe("unknown");
    });
  });

  describe("STREAM_EVENT_BUFFER_MAX", () => {
    it("is set to 200", () => {
      expect(AgentViewerOverlay.STREAM_EVENT_BUFFER_MAX).toBe(200);
    });
  });
});
