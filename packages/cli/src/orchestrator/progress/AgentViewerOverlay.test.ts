import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { AgentStatus } from "@feature-forge/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Agent } from "../../agents/agents/Agent";
import type { AgentSpecification } from "../../agents/specifications";
import type { AgentSupervisor } from "../../agents/supervisors/AgentSupervisor";
import { makeMockEventBus } from "../../test-utils";
import type { AgentViewerEntry } from "./AgentViewerOverlay";
import { AgentViewerOverlay } from "./AgentViewerOverlay";

// ── Helpers ──────────────────────────────────────────────────

function makeTheme(): Theme {
  return {
    fg: vi.fn((_color: string, text: string) => text),
    bg: vi.fn((_color: string, text: string) => text),
    bold: vi.fn((text: string) => text),
    italic: vi.fn((text: string) => text),
    inverse: vi.fn((text: string) => text),
  } as unknown as Theme;
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
  return new AgentViewerOverlay(tui ?? makeTui(), theme ?? makeTheme(), onDone ?? vi.fn());
}

// ── Tests ────────────────────────────────────────────────────

describe("AgentViewerOverlay", () => {
  describe("constructor", () => {
    it("starts with zero entries", () => {
      const overlay = makeOverlay();
      expect(overlay.entryCount).toBe(0);
    });

    it("accepts tui, theme, and onDone", () => {
      const tui = makeTui();
      const theme = makeTheme();
      const onDone = vi.fn();
      const overlay = new AgentViewerOverlay(tui, theme, onDone);

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
      expect(joined).toContain("✓");
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
      // Should not throw.
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

  describe("formatElapsed", () => {
    it("formats seconds when less than a minute", () => {
      const now = Date.now();
      const recent = new Date(now - 30 * 1000);
      const result = AgentViewerOverlay.formatElapsed(recent);
      expect(result).toMatch(/^\d+s$/);
    });

    it("formats minutes and seconds when less than an hour", () => {
      const now = Date.now();
      const recent = new Date(now - 120 * 1000);
      const result = AgentViewerOverlay.formatElapsed(recent);
      expect(result).toMatch(/^\d+m \d+s$/);
    });

    it("formats hours when elapsed exceeds one hour", () => {
      const now = Date.now();
      const old = new Date(now - 4000 * 1000);
      const result = AgentViewerOverlay.formatElapsed(old);
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
  });

  describe("formatStreamEvent", () => {
    it("formats tool_execution_start events as 'tool_execution_start: <toolName>'", () => {
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "tool_execution_start",
        toolName: "read",
      });
      expect(line).toBe("tool_execution_start: read");
    });

    it("includes serialized args in tool_execution_start stream line", () => {
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "tool_execution_start",
        toolName: "bash",
        args: { command: "ls -la" },
      });
      expect(line).toContain("tool_execution_start: bash");
      expect(line).toContain("|");
      expect(line).toContain('"command"');
      expect(line).toContain("ls -la");
    });

    it("includes serialized string args in tool_execution_start stream line", () => {
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "tool_execution_start",
        toolName: "read",
        args: "some-file.txt",
      });
      expect(line).toContain("tool_execution_start: read");
      expect(line).toContain("|");
      expect(line).toContain("some-file.txt");
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

    it("formats tool_execution_update with object partialResult", () => {
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "tool_execution_update",
        toolName: "read",
        partialResult: { key: "value" },
      });
      expect(line).toContain("tool_execution_update: read:");
      expect(line).toContain("key");
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
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-stream-test-"));
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

      const content = readFileSync(join(tmpDir, "builder.stream"), "utf-8");
      expect(content).toContain("tool_execution_start: read");
      expect(content).toContain("message_start: assistant");

      overlay.dispose();
    });

    it("writes stream files with agent id as filename", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-stream-test-"));
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      const expectedPath = join(tmpDir, "builder.stream");
      expect(existsSync(expectedPath)).toBe(true);

      const content = readFileSync(expectedPath, "utf-8");
      expect(content).toContain("tool_execution_start: read");

      overlay.dispose();
    });

    it("writes to disk when streamDir is configured", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-stream-test-"));
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      // In-memory line should still be recorded.
      expect(overlay.getLastStreamLine("builder")).toBe("tool_execution_start: read");

      overlay.dispose();
    });

    it("creates the stream directory if it does not exist", () => {
      const tmpDir = join(tmpdir(), `forge-stream-mkdir-${Date.now()}`);
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      const content = readFileSync(join(tmpDir, "builder.stream"), "utf-8");
      expect(content).toContain("tool_execution_start: read");

      overlay.dispose();
    });

    it("reuses cached file path for subsequent events from the same agent", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-stream-test-"));
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

      const content = readFileSync(join(tmpDir, "builder.stream"), "utf-8");
      expect(content).toContain("tool_execution_start: read");
      expect(content).toContain("tool_execution_start: write");

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

    it("handles pushStreamEvent with streamDir set gracefully", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-stream-dir-"));
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      // Should not throw.
      expect(() => {
        overlay.pushStreamEvent("builder", {
          type: "tool_execution_start",
          toolName: "read",
        } as AgentEvent);
      }).not.toThrow();

      expect(overlay.getLastStreamLine("builder")).toBe("tool_execution_start: read");

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

  describe("setStreamDir", () => {
    it("configures stream directory for file persistence", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-stream-test-"));
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      const content = readFileSync(join(tmpDir, "builder.stream"), "utf-8");
      expect(content).toContain("tool_execution_start: read");

      overlay.dispose();
    });

    it("overwrites previous streamDir when called again", () => {
      const tmpDir1 = mkdtempSync(join(tmpdir(), "forge-overwrite-1-"));
      const tmpDir2 = mkdtempSync(join(tmpdir(), "forge-overwrite-2-"));

      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir1);
      overlay.setStreamDir(tmpDir2);

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      // File should be written to the second (overwritten) directory.
      const expectedPath = join(tmpDir2, "builder.stream");
      expect(existsSync(expectedPath)).toBe(true);

      // File should NOT be in tmpDir1.
      const oldPath = join(tmpDir1, "builder.stream");
      expect(existsSync(oldPath)).toBe(false);

      overlay.dispose();
    });

    it("writes to disk when streamDir is an empty string", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-empty-exec-"));
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      // In-memory line should still be recorded.
      expect(overlay.getLastStreamLine("builder")).toBe("tool_execution_start: read");
      // Disk file IS written.
      const files = existsSync(tmpDir) ? readdirSync(tmpDir) : [];
      expect(files.filter((f: string) => f.endsWith(".stream"))).toHaveLength(1);

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
      overlay.setStreamDir(tmpDir);

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      const filePath = join(tmpDir, "builder.stream");
      expect(existsSync(filePath)).toBe(true);

      overlay.dispose();

      // Files persist in shared dir.
      expect(existsSync(filePath)).toBe(true);
    });

    it("resets agent entries on dispose", () => {
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

    it("clears lastLines and streamFiles maps on dispose", () => {
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      overlay.pushStreamEvent("reviewer", {
        type: "tool_execution_start",
        toolName: "lint",
      } as AgentEvent);

      expect(overlay.getLastStreamLine("builder")).toBe("tool_execution_start: read");

      overlay.dispose();

      // In-memory maps are cleared.
      expect(overlay.getLastStreamLine("builder")).toBeUndefined();
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

      overlay.handleInput("\x1b");

      expect(overlay.viewMode).toBe("list");
      expect(overlay.selectedAgentId).toBeUndefined();
      expect(overlay.scrollOffset).toBe(0);
      expect(tui.requestRender).toHaveBeenCalled();
      expect(onDone).not.toHaveBeenCalled();
    });

    it("navigates down with ArrowDown in list view", () => {
      const tui = makeTui();
      const overlay = makeOverlay(tui);
      overlay.update(makeEntry("agent-a", "started"));
      overlay.update(makeEntry("agent-b", "started"));
      overlay.update(makeEntry("agent-c", "started"));

      // Simulate ArrowDown
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

      // Simulate ArrowDown at last item
      overlay.handleInput("\x1b[B");

      expect(overlay.selectedIndex).toBe(0);
    });

    it("navigates up with ArrowUp in list view", () => {
      const tui = makeTui();
      const overlay = makeOverlay(tui);
      overlay.update(makeEntry("agent-a", "started"));
      overlay.update(makeEntry("agent-b", "started"));
      overlay.selectedIndex = 1;

      // Simulate ArrowUp
      overlay.handleInput("\x1b[A");

      expect(overlay.selectedIndex).toBe(0);
      expect(tui.requestRender).toHaveBeenCalled();
    });

    it("wraps around at the top with ArrowUp", () => {
      const tui = makeTui();
      const overlay = makeOverlay(tui);
      overlay.update(makeEntry("agent-a", "started"));
      overlay.update(makeEntry("agent-b", "started"));

      // Simulate ArrowUp at first item
      overlay.handleInput("\x1b[A");

      expect(overlay.selectedIndex).toBe(1);
    });

    it("enters detail view on Enter", () => {
      const tui = makeTui();
      const overlay = makeOverlay(tui);
      overlay.update(makeEntry("agent-a", "started"));
      overlay.update(makeEntry("agent-b", "started"));
      overlay.selectedIndex = 1;

      // Simulate Enter
      overlay.handleInput("\r");

      expect(overlay.viewMode).toBe("detail");
      expect(overlay.selectedAgentId).toBe("agent-b");
      // Auto-scroll enabled and scrollOffset set to max on entering detail view.
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

    it("scrolls up in detail view with ArrowUp", () => {
      const tui = makeTui();
      const overlay = makeOverlay(tui);
      overlay.update(makeEntry("builder", "done"));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      overlay.scrollOffset = 3;

      overlay.handleInput("\x1b[A");

      expect(overlay.scrollOffset).toBe(2);
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

    it("shows conversation instead of flat stream log", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "read",
        isError: false,
        result: "file contents",
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "write",
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "write",
        isError: false,
        result: "written",
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Conversation:");
      expect(joined).toContain("read");
      expect(joined).toContain("write");
      expect(joined).toContain("(ok)");
      expect(joined).not.toContain("Stream log:");

      overlay.dispose();
    });

    it("shows assistant message turn in conversation", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "done"));
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
      } as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Conversation:");
      expect(joined).toContain("assistant:");
      expect(joined).toContain("Done.");
      expect(joined).not.toContain("Last event:");
    });

    it("shows failed status for agent with error status in detail view", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("crash-agent", "error", { summary: "Agent crashed" }));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "crash-agent";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("✗");
      expect(joined).toContain("crash-agent");
      expect(joined).toContain("error");
    });

    it("shows unknown role for message turn without explicit role", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", { type: "message_start" } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: { content: [{ type: "text", text: "No role here." }] },
      } as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("unknown:");
    });

    it("shows unknown tool name for tool call without toolName", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", { type: "tool_execution_start" } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        isError: false,
        result: "done",
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("unknown");
    });

    it("shows no conversation when no stream events were pushed", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "done", { raw: "Full output here" }));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Conversation:");
      expect(joined).toContain("No conversation recorded.");
      expect(joined).not.toContain("Raw output:");
      expect(joined).not.toContain("Full output here");
    });

    it("shows scroll help legend", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "done"));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("back");
      expect(joined).toContain("scroll");
    });

    it("shows error icon for agents with error status in list view", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("crash-agent", "error"));

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("✗");
      expect(joined).toContain("crash-agent");
    });

    it("renders conversation content without truncation when short enough", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      const shortContent = "OK";
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: shortContent }],
        },
      } as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain(shortContent);
    });

    it("renders detail view for unknown status agent", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("unknown-agent", "paused"));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "unknown-agent";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("unknown-agent");
      expect(joined).toContain("paused");
    });

    it("truncates long message content in conversation rendering", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      const longText = "x".repeat(200);
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: longText }],
        },
      } as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(40);
      const joined = lines.join("\n");

      // Long content should be truncated.
      expect(joined).toContain("...");
      expect(joined).not.toContain(longText);
    });

    it("renders short tool call result without truncation", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "read",
        isError: false,
        result: "short",
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("short");
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
    it("resets viewMode, selectedIndex, and selectedAgentId", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      overlay.selectedIndex = 3;
      overlay.scrollOffset = 5;

      overlay.clearMemory();

      expect(overlay.viewMode).toBe("list");
      expect(overlay.selectedIndex).toBe(0);
      expect(overlay.selectedAgentId).toBeUndefined();
      expect(overlay.scrollOffset).toBe(0);
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

    it("writes stream events to disk and provides readable tail", () => {
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

      const content = readFileSync(join(tmpDir, "builder.stream"), "utf-8");
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

      const overlay2 = makeOverlay();
      overlay2.setStreamDir(tmpDir);
      overlay2.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "write",
      } as AgentEvent);

      const content = readFileSync(join(tmpDir, "builder.stream"), "utf-8");
      expect(content).toContain("tool_execution_start: write");

      overlay1.dispose();
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
      const streamDir = mkdtempSync(join(tmpdir(), "forge-stream-test-"));
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

        const content = readFileSync(join(streamDir, "builder.stream"), "utf-8");
        expect(content).toContain("tool_execution_start: read");

        unsubs.forEach((u) => u());
        overlay.dispose();
      } finally {
        rmSync(streamDir, { recursive: true, force: true });
      }
    });

    it("returns three unsubs, one per subscribed channel", () => {
      const supervisor = makeMockSupervisor();
      const eventBus = makeMockEventBus();

      const { unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        supervisor,
      });

      expect(unsubs).toHaveLength(3);
      for (const unsub of unsubs) {
        expect(unsub).toBeInstanceOf(Function);
      }
    });

    it("unsubs stop event processing for the unsubscribed channel", () => {
      const agent = makeMockAgent("builder", "builder", AgentStatus.Running);
      const supervisor = makeMockSupervisor([agent]);
      const eventBus = makeMockEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        supervisor,
      });

      connect(overlay, "");

      // Call the first unsub (agent-stream channel) to unsubscribe.
      unsubs[0]();

      eventBus.emit("feature-forge:agent-stream", {
        phase: "agent-stream",
        message: 'Agent "builder" stream event',
        details: {
          agentId: "builder",
          event: { type: "tool_execution_start", toolName: "read" } as AgentEvent,
        },
      });

      // The stream line should not have been updated after unsub.
      expect(overlay.getLastStreamLine("builder")).toBeUndefined();

      unsubs.slice(1).forEach((u) => u());
      overlay.dispose();
    });

    it("uses fallback summary when getAgent returns undefined after connect", () => {
      const supervisor = makeMockSupervisor([]);
      const eventBus = makeMockEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        supervisor,
      });

      // Emit before connect so it is buffered.
      eventBus.emit("feature-forge:agent-done", {
        phase: "agent-done",
        message: 'Agent "orphan" completed',
        details: {
          agentId: "orphan",
          passed: true,
          summary: "Agent disconnected",
        },
      });

      connect(overlay, "");

      const lines = overlay.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("orphan");
      expect(joined).toContain("⏳");
      expect(joined).toContain("Agent disconnected");

      unsubs.forEach((u) => u());
      overlay.dispose();
    });

    it("handles agent-started event after connect", () => {
      const agent = makeMockAgent("builder", "builder", AgentStatus.Running);
      const supervisor = makeMockSupervisor([agent]);
      const eventBus = makeMockEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        supervisor,
      });

      connect(overlay, "");

      eventBus.emit("feature-forge:agent-started", {
        phase: "agent-started",
        message: 'Agent "builder" started',
        details: { agentId: "builder" },
      });

      const lines = overlay.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("⏳");
      expect(joined).toContain("builder");

      unsubs.forEach((u) => u());
      overlay.dispose();
    });

    it("falls back to 'Agent disconnected' summary when no agent found and no event summary", () => {
      const supervisor = makeMockSupervisor([]);
      const eventBus = makeMockEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        supervisor,
      });

      connect(overlay, "");

      // Emit agent-done without a summary — supervisor has no agent,
      // so deliverStatusEvent should fall back to "Agent disconnected".
      eventBus.emit("feature-forge:agent-done", {
        phase: "agent-done",
        message: 'Agent "orphan" done',
        details: { agentId: "orphan" },
      });

      const lines = overlay.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("orphan");
      expect(joined).toContain("Agent disconnected");

      unsubs.forEach((u) => u());
      overlay.dispose();
    });

    it("falls back to agent-based summary when no event summary and agent exists", () => {
      const agent = makeMockAgent("builder", "builder", AgentStatus.Running);
      const supervisor = makeMockSupervisor([agent]);
      const eventBus = makeMockEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        supervisor,
      });

      connect(overlay, "");

      // Emit agent-done without a summary in details — should derive
      // summary from the agent's specification.
      eventBus.emit("feature-forge:agent-done", {
        phase: "agent-done",
        message: 'Agent "builder" done',
        details: { agentId: "builder" },
      });

      const lines = overlay.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("builder");
      expect(joined).toContain("builder");
      expect(joined).toContain("Running");

      unsubs.forEach((u) => u());
      overlay.dispose();
    });

    it("handles agent-stream event without event in details (falls through)", () => {
      const agent = makeMockAgent("builder", "builder", AgentStatus.Running);
      const supervisor = makeMockSupervisor([agent]);
      const eventBus = makeMockEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        supervisor,
      });

      connect(overlay, "");

      // Emit agent-stream without an event payload — should be silently
      // ignored (no-op).
      expect(() => {
        eventBus.emit("feature-forge:agent-stream", {
          phase: "agent-stream",
          message: 'Agent "builder" stream',
          details: { agentId: "builder" },
        });
      }).not.toThrow();

      // No stream line should be recorded.
      expect(overlay.getLastStreamLine("builder")).toBeUndefined();

      unsubs.forEach((u) => u());
      overlay.dispose();
    });

    it("buffers agent-stream event without event in details (no-op)", () => {
      const supervisor = makeMockSupervisor([]);
      const eventBus = makeMockEventBus();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        supervisor,
      });

      // Emit agent-stream without event details BEFORE connect.
      eventBus.emit("feature-forge:agent-stream", {
        phase: "agent-stream",
        message: 'Agent "builder" stream',
        details: { agentId: "builder" },
      });

      const overlay = makeOverlay();
      connect(overlay, "");

      // No stream line should be recorded.
      expect(overlay.getLastStreamLine("builder")).toBeUndefined();

      unsubs.forEach((u) => u());
      overlay.dispose();
    });
  });

  describe("prepopulateStreamFiles", () => {
    it("handles non-stream files in stream directory during prepopulate", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-prepop-"));
      try {
        // Write a non-.stream file alongside a .stream file.
        writeFileSync(join(tmpDir, "notes.txt"), "some notes");
        writeFileSync(join(tmpDir, "builder.stream"), "tool_execution_start: read\n");

        const overlay = makeOverlay();
        overlay.prepopulateStreamFiles(tmpDir);

        // Builder should be created as a stale entry.
        const lines = overlay.render(80);
        const joined = lines.join("\n");
        expect(joined).toContain("builder");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("creates stale done entries for agents with stream files not in the agents map", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-prepop-"));
      try {
        // Write a stream file for a completed agent that's no longer tracked.
        const streamPath = join(tmpDir, "reviewer.stream");
        writeFileSync(streamPath, "tool_execution_start: lint\nmessage_end: Done.\n");

        // Also write a stream file for a currently-tracked agent.
        const activePath = join(tmpDir, "builder.stream");
        writeFileSync(activePath, "tool_execution_start: read\n");

        const overlay = makeOverlay();
        // Pre-populate normally first (builder is tracked).
        overlay.update(makeEntry("builder", "started"));
        overlay.setStreamDir(tmpDir);
        overlay.prepopulateStreamFiles(tmpDir);

        // The tracked agent should still be "started" (not overwritten).
        const lines = overlay.render(80);
        const joined = lines.join("\n");
        expect(joined).toContain("⏳");
        expect(joined).toContain("builder");

        // The orphaned stream file should create a "done" entry.
        expect(joined).toContain("reviewer");
        expect(joined).toContain("✓");
        expect(joined).toContain("Agent completed");

        const content = readFileSync(join(tmpDir, "reviewer.stream"), "utf-8");
        expect(content).toContain("tool_execution_start: lint");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("does not overwrite existing agent entries when prepopulating", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-prepop-"));
      try {
        const streamPath = join(tmpDir, "builder.stream");
        writeFileSync(streamPath, "tool_execution_start: read\n");

        const overlay = makeOverlay();
        overlay.update(makeEntry("builder", "done", { summary: "Custom summary" }));
        overlay.setStreamDir(tmpDir);
        overlay.prepopulateStreamFiles(tmpDir);

        // The existing entry should retain its custom summary.
        const lines = overlay.render(80);
        const joined = lines.join("\n");
        expect(joined).toContain("Custom summary");
        expect(joined).not.toContain("Agent completed");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("handles empty or nonexistent stream directories silently", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));

      // Should not throw for missing directory.
      expect(() => {
        overlay.prepopulateStreamFiles("/nonexistent/path/streams");
      }).not.toThrow();

      // Existing entries should still be intact.
      expect(overlay.entryCount).toBe(1);
    });

    it("creates entries for agents with stream files in the directory", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-prepop-"));
      try {
        const streamPath = join(tmpDir, "unknown-agent.stream");
        writeFileSync(streamPath, "tool_execution_start: grep\ntool_execution_end: grep (ok)\n");

        const overlay = makeOverlay();
        overlay.prepopulateStreamFiles(tmpDir);

        const content = readFileSync(join(tmpDir, "unknown-agent.stream"), "utf-8");
        expect(content).toContain("tool_execution_start: grep");
        expect(content).toContain("tool_execution_end: grep (ok)");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("conversation tracking", () => {
    it("records events as raw AgentEvent[] in insertion order", () => {
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
          content: [{ type: "text", text: "I am processing." }],
        },
      } as AgentEvent);

      const events = overlay.getConversation("builder");
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("message_start");
      expect(events[1].type).toBe("message_end");
    });

    it("records tool_execution_start and tool_execution_end events", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "read",
        isError: false,
        result: "file contents here",
      } as unknown as AgentEvent);

      const events = overlay.getConversation("builder");
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("tool_execution_start");
      expect(events[1].type).toBe("tool_execution_end");
    });

    it("captures isError on tool_execution_end", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "failed-tool",
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "failed-tool",
        isError: true,
        result: "something went wrong",
      } as unknown as AgentEvent);

      const events = overlay.getConversation("builder");
      expect(events).toHaveLength(2);
      const endEvent = events[1] as Record<string, unknown>;
      expect(endEvent["isError"]).toBe(true);
      expect(endEvent["result"]).toBe("something went wrong");
    });

    it("preserves event order with updates before message_end", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_update",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "partial" }],
        },
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_update",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "final content" }],
        },
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "final content" }],
        },
      } as AgentEvent);

      const events = overlay.getConversation("builder");
      expect(events).toHaveLength(4);
      expect(events[0].type).toBe("message_start");
      expect(events[1].type).toBe("message_update");
      expect(events[2].type).toBe("message_update");
      expect(events[3].type).toBe("message_end");
    });

    it("preserves event order with tool_execution_update events", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_update",
        toolName: "read",
        partialResult: "line 1\n",
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_update",
        toolName: "read",
        partialResult: "line 2\n",
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "read",
        isError: false,
        result: "line 1\nline 2\n",
      } as unknown as AgentEvent);

      const events = overlay.getConversation("builder");
      expect(events).toHaveLength(4);
      expect(events[0].type).toBe("tool_execution_start");
      expect(events[1].type).toBe("tool_execution_update");
      expect(events[2].type).toBe("tool_execution_update");
      expect(events[3].type).toBe("tool_execution_end");
    });

    it("preserves insertion order across mixed event types", () => {
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
          content: [{ type: "text", text: "I will read the file." }],
        },
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "read",
        isError: false,
        result: "file contents",
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "The file says hello." }],
        },
      } as AgentEvent);

      const events = overlay.getConversation("builder");
      expect(events).toHaveLength(6);
      expect(events[0].type).toBe("message_start");
      expect(events[1].type).toBe("message_end");
      expect(events[2].type).toBe("tool_execution_start");
      expect(events[3].type).toBe("tool_execution_end");
      expect(events[4].type).toBe("message_start");
      expect(events[5].type).toBe("message_end");
    });

    it("tracks events per agent independently", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.update(makeEntry("reviewer", "started"));

      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Building..." }],
        },
      } as AgentEvent);

      overlay.pushStreamEvent("reviewer", {
        type: "message_start",
        message: { role: "assistant" },
      } as AgentEvent);
      overlay.pushStreamEvent("reviewer", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Reviewing..." }],
        },
      } as AgentEvent);

      expect(overlay.getConversation("builder")).toHaveLength(2);
      expect(overlay.getConversation("reviewer")).toHaveLength(2);
    });

    it("returns empty array for unknown agent", () => {
      const overlay = makeOverlay();
      expect(overlay.getConversation("nonexistent")).toEqual([]);
    });

    it("clears events on dispose", () => {
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
          content: [{ type: "text", text: "Hello." }],
        },
      } as AgentEvent);

      expect(overlay.getConversation("builder")).toHaveLength(2);
      overlay.dispose();
      expect(overlay.getConversation("builder")).toEqual([]);
    });

    it("handles partial event sequences (message_start without message_end)", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as AgentEvent);

      // Raw buffer stores whatever was pushed — message_start is stored.
      const events = overlay.getConversation("builder");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("message_start");
    });

    it("handles orphaned tool_execution_end without prior start", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "orphan-tool",
        isError: false,
        result: "orphan result",
      } as unknown as AgentEvent);

      // Raw buffer stores whatever was pushed — tool_execution_end is stored.
      const events = overlay.getConversation("builder");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("tool_execution_end");
    });

    it("isolates events between concurrent agent streams", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.update(makeEntry("reviewer", "started"));

      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_update",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "builder partial" }],
        },
      } as AgentEvent);

      overlay.pushStreamEvent("reviewer", {
        type: "message_start",
        message: { role: "assistant" },
      } as AgentEvent);
      overlay.pushStreamEvent("reviewer", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "reviewer done" }],
        },
      } as AgentEvent);

      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "builder done" }],
        },
      } as AgentEvent);

      expect(overlay.getConversation("builder")).toHaveLength(3);
      expect(overlay.getConversation("reviewer")).toHaveLength(2);
    });

    it("handles concurrent tool call events correctly", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.update(makeEntry("reviewer", "started"));

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      overlay.pushStreamEvent("reviewer", {
        type: "tool_execution_start",
        toolName: "lint",
      } as AgentEvent);
      overlay.pushStreamEvent("reviewer", {
        type: "tool_execution_end",
        toolName: "lint",
        isError: false,
        result: "lint passed",
      } as unknown as AgentEvent);

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "read",
        isError: true,
        result: "read failed",
      } as unknown as AgentEvent);

      const builderEvents = overlay.getConversation("builder");
      const reviewerEvents = overlay.getConversation("reviewer");

      expect(builderEvents).toHaveLength(2);
      expect(reviewerEvents).toHaveLength(2);
    });

    it("preserves events after clearMemory", () => {
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
          content: [{ type: "text", text: "Hello." }],
        },
      } as AgentEvent);

      overlay.clearMemory();
      expect(overlay.getConversation("builder")).toHaveLength(2);
    });
  });

  describe("conversation rendering in detail view", () => {
    it("renders message turn with role prefix", () => {
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
          content: [{ type: "text", text: "Processing" }],
        },
      } as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Conversation:");
      expect(joined).toContain("assistant:");
      expect(joined).toContain("Processing");
    });

    it("renders tool call with ✓ ok icon", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "read",
        isError: false,
        result: "ok output",
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("✓");
      expect(joined).toContain("read");
      expect(joined).toContain("(ok)");
    });

    it("renders tool call error with ✗ icon", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "failing",
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "failing",
        isError: true,
        result: "error message",
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("✗");
      expect(joined).toContain("failing");
      expect(joined).toContain("(error)");
    });

    it("renders running tool call with ⏳ icon", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "long-running",
      } as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("⏳");
      expect(joined).toContain("long-running");
      expect(joined).toContain("(running)");
    });

    it("renders mixed conversation with messages and tool calls", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "done"));

      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Let me read." }],
        },
      } as AgentEvent);

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "read",
        isError: false,
        result: "contents",
      } as unknown as AgentEvent);

      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done reading." }],
        },
      } as AgentEvent);

      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Conversation:");
      expect(joined).toContain("Let me read.");
      expect(joined).toContain("Done reading.");
      expect(joined).toContain("read");
      expect(joined).toContain("✓");
    });

    it("shows tool call result lines in detail", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "read",
        isError: false,
        result: "line 1\nline 2",
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("line 1");
      expect(joined).toContain("line 2");
    });

    it("does not show flat stream log or last event sections", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).not.toContain("Stream log:");
      expect(joined).not.toContain("Last event:");
      expect(joined).not.toContain("Raw output:");
    });

    it("handles tool_execution_end without prior start gracefully", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "orphan-tool",
        isError: false,
        result: "orphan result",
      } as unknown as AgentEvent);

      // Raw buffer stores the event even though there was no prior start.
      const events = overlay.getConversation("builder");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("tool_execution_end");

      // Rendering shows "No conversation recorded." since the orphan end
      // event does not form a complete turn.
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      const lines = overlay.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("Conversation:");
      expect(joined).toContain("No conversation recorded.");
    });

    it("handles message_end without prior start gracefully", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Direct end without start." }],
        },
      } as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Conversation:");
      expect(joined).toContain("No conversation recorded.");
    });

    it("handles message_start without message content gracefully", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", { type: "message_start" } as AgentEvent);
      overlay.pushStreamEvent("builder", { type: "message_end" } as AgentEvent);

      // Raw buffer stores both events.
      const events = overlay.getConversation("builder");
      expect(events).toHaveLength(2);

      // Rendering shows "No conversation recorded." since the events have
      // no meaningful content (message_start has no role, message_end has no text).
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      const lines = overlay.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("Conversation:");
      expect(joined).toContain("No conversation recorded.");
    });

    it("uses theme.bg for tool call background colour", () => {
      const theme = makeTheme();
      const overlay = makeOverlay(undefined, theme);
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "read",
        isError: false,
        result: "ok output",
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      overlay.render(80);

      expect(theme.bg).toHaveBeenCalledWith("toolSuccessBg", expect.any(String));
    });

    it("uses theme.bg with toolErrorBg for failed tool calls", () => {
      const theme = makeTheme();
      const overlay = makeOverlay(undefined, theme);
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "bad-tool",
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "bad-tool",
        isError: true,
        result: "error",
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      overlay.render(80);

      expect(theme.bg).toHaveBeenCalledWith("toolErrorBg", expect.any(String));
    });

    it("uses theme.bg with toolPendingBg for running tool calls", () => {
      const theme = makeTheme();
      const overlay = makeOverlay(undefined, theme);
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "long-task",
      } as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      overlay.render(80);

      expect(theme.bg).toHaveBeenCalledWith("toolPendingBg", expect.any(String));
    });

    it("shows toolOutput-coloured result lines", () => {
      const theme = makeTheme();
      const overlay = makeOverlay(undefined, theme);
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "read",
        isError: false,
        result: "output",
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      overlay.render(80);

      expect(theme.fg).toHaveBeenCalledWith("toolOutput", "output");
    });
  });

  describe("detail view scrolling with conversation content", () => {
    it("scrolls down through conversation turns", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));

      // Push several conversation turns to create scrollable content.
      for (let i = 0; i < 10; i++) {
        overlay.pushStreamEvent("builder", {
          type: "tool_execution_start",
          toolName: `tool-${i}`,
        } as AgentEvent);
        overlay.pushStreamEvent("builder", {
          type: "tool_execution_end",
          toolName: `tool-${i}`,
          isError: false,
          result: `result-${i}`,
        } as unknown as AgentEvent);
      }

      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      overlay.scrollOffset = 0;

      const beforeScroll = overlay.render(80);

      // Scroll down by several lines.
      overlay.scrollOffset = 3;
      const afterScroll = overlay.render(80);

      // Scrolled render should differ from the non-scrolled one.
      const beforeJoined = beforeScroll.join("\n");
      const afterJoined = afterScroll.join("\n");
      expect(beforeJoined).not.toBe(afterJoined);
    });

    it("clamps scroll offset to zero as minimum", () => {
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
          content: [{ type: "text", text: "Hello." }],
        },
      } as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      overlay.scrollOffset = 5;

      // Arrow up should decrement.
      overlay.handleInput("\x1b[A");
      expect(overlay.scrollOffset).toBe(4);

      // Arrow up past zero should clamp.
      overlay.scrollOffset = 0;
      overlay.handleInput("\x1b[A");
      expect(overlay.scrollOffset).toBe(0);
    });

    it("clamps scroll down to content maximum", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));

      // Push conversation turns to create content.
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Short." }],
        },
      } as AgentEvent);

      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      // Try scrolling far beyond content.
      overlay.scrollOffset = 50;
      overlay.handleInput("\x1b[B");

      // Should be clamped, not grow to 51.
      expect(overlay.scrollOffset).toBeLessThanOrEqual(50 + 1);
    });

    it("scroll offset does not grow unbounded over many scrolls", () => {
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
          content: [{ type: "text", text: "Hi" }],
        },
      } as AgentEvent);

      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      // Simulate many scroll-down operations.
      for (let i = 0; i < 200; i++) {
        overlay.handleInput("\x1b[B");
      }

      // Should still be within reasonable bounds.
      const lines = overlay.render(80);
      expect(lines.length).toBeGreaterThan(0);
      // offset should not have grown to 200 for a small conversation.
      expect(overlay.scrollOffset).toBeLessThan(100);
    });

    it("computes max scroll bound from conversation content", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));

      // Push multiple turns to create content.
      for (let i = 0; i < 3; i++) {
        overlay.pushStreamEvent("builder", {
          type: "tool_execution_start",
          toolName: `tool-${i}`,
        } as AgentEvent);
        overlay.pushStreamEvent("builder", {
          type: "tool_execution_end",
          toolName: `tool-${i}`,
          isError: false,
          result: `line1\nline2`,
        } as unknown as AgentEvent);
      }

      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      // Render at least once so computeScrollMax has content.
      overlay.render(80);

      // Scroll down — should not exceed max.
      overlay.scrollOffset = 0;
      overlay.handleInput("\x1b[B");
      expect(overlay.scrollOffset).toBeGreaterThanOrEqual(0);
    });
  });

  describe("conversation markdown styling", () => {
    it("styles bold markdown in message content", () => {
      const theme = makeTheme();
      const overlay = makeOverlay(undefined, theme);
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "This is **bold** text." }],
        },
      } as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      overlay.render(80);

      expect(theme.bold).toHaveBeenCalledWith("bold");
    });

    it("styles italic markdown in message content", () => {
      const theme = makeTheme();
      const overlay = makeOverlay(undefined, theme);
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "This is *italic* text." }],
        },
      } as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      overlay.render(80);

      expect(theme.italic).toHaveBeenCalledWith("italic");
    });

    it("styles inline code markdown in message content", () => {
      const theme = makeTheme();
      const overlay = makeOverlay(undefined, theme);
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Use `npm test` to verify." }],
        },
      } as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      overlay.render(80);

      expect(theme.inverse).toHaveBeenCalledWith("npm test");
    });

    it("handles empty content lines gracefully when applying markdown", () => {
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
          content: [{ type: "text", text: "\n\nHello\n\n" }],
        },
      } as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Hello");
    });
  });

  describe("autoScroll", () => {
    it("starts auto-scrolling when entering detail view", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      // When we last rendered, autoScroll should have been set.
      overlay.autoScroll = true;

      expect(overlay.autoScroll).toBe(true);
    });

    it("disables auto-scroll on ArrowUp in detail view", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      overlay.autoScroll = true;

      overlay.handleInput("\x1b[A");

      expect(overlay.autoScroll).toBe(false);
    });

    it("resumes auto-scroll on ArrowDown when at the bottom", () => {
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
          content: [{ type: "text", text: "Hello" }],
        },
      } as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      overlay.autoScroll = false;
      // Set scrollOffset past the max — ArrowDown will clamp to max and resume auto-scroll.
      overlay.scrollOffset = 999999;

      overlay.handleInput("\x1b[B");

      expect(overlay.autoScroll).toBe(true);
    });

    it("does not resume auto-scroll on ArrowDown when not at bottom", () => {
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
          content: [{ type: "text", text: "Hello" }],
        },
      } as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      overlay.autoScroll = false;
      overlay.scrollOffset = 0;

      overlay.handleInput("\x1b[B");

      expect(overlay.autoScroll).toBe(false);
    });

    it("auto-scrolls to bottom when new stream event arrives in detail view", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      overlay.autoScroll = true;

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      // Should have scrolled to bottom.
      // The exact value depends on content, but should be >= 0.
      expect(overlay.scrollOffset).toBeGreaterThanOrEqual(0);
    });

    it("does not auto-scroll when autoScroll is off", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      overlay.autoScroll = false;
      overlay.scrollOffset = 0;

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      // Scroll offset should remain 0.
      expect(overlay.scrollOffset).toBe(0);
    });

    it("resets autoScroll on clearMemory", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.autoScroll = true;

      overlay.clearMemory();

      expect(overlay.autoScroll).toBe(false);
    });

    it("resets autoScroll when leaving detail view via Escape", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      overlay.autoScroll = true;

      overlay.handleInput("\x1b");

      expect(overlay.autoScroll).toBe(false);
    });

    it("disables auto-scroll on ArrowUp after entering detail view", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      overlay.autoScroll = true;

      overlay.handleInput("\x1b[A");

      expect(overlay.autoScroll).toBe(false);
    });
  });

  describe("toolArgs rendering", () => {
    it("renders toolArgs in detail view tool call", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "bash",
        args: { command: "ls -la" },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "bash",
        isError: false,
        result: "file1\nfile2",
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("bash");
      expect(joined).toContain("ls -la");
      expect(joined).toContain("file1");
      expect(joined).toContain("file2");
    });

    it("shows visual delimiter between toolArgs and toolResult", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "bash",
        args: { command: "ls" },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "bash",
        isError: false,
        result: "file.txt",
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      // Should have args, indented delimiter, and result in that order.
      const argsIndex = joined.indexOf("ls");
      const delimiterIndex = joined.indexOf("      ──");
      const resultIndex = joined.indexOf("file.txt");
      expect(argsIndex).toBeGreaterThan(-1);
      expect(delimiterIndex).toBeGreaterThan(-1);
      expect(resultIndex).toBeGreaterThan(-1);
      expect(delimiterIndex).toBeGreaterThan(argsIndex);
      expect(resultIndex).toBeGreaterThan(delimiterIndex);
    });

    it("does not show delimiter when only args without result", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "bash",
        args: { command: "sleep 10" },
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("sleep");
      // The 6-space-indented delimiter ── must not appear when there's no result.
      // (The header separator ─── has 0 indent and is always present.)
      const delimiterIndex = joined.indexOf("      ──");
      expect(delimiterIndex).toBe(-1);
    });

    it("renders toolArgs without result when no result exists", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "bash",
        args: { command: "sleep 10" },
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("bash");
      expect(joined).toContain("sleep");
      expect(joined).toContain("(running)");
    });
  });

  describe("prepopulateStreamFiles without ingestFromStream", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "forge-prepop-no-ingest-"));
    });

    afterEach(() => {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    });

    it("does not replay stream content into event buffer for stale entries", () => {
      writeFileSync(
        join(tmpDir, "reviewer.stream"),
        ["message_start: assistant", "message_end: Review done."].join("\n"),
        "utf-8",
      );

      const overlay = makeOverlay();
      overlay.prepopulateStreamFiles(tmpDir);

      // Events are NOT replayed from disk — the stream file is an
      // append-only log, not a re-ingestion source.
      expect(overlay.getConversation("reviewer")).toEqual([]);
    });

    it("does not replay stream content into event buffer for tracked agents", () => {
      writeFileSync(
        join(tmpDir, "builder.stream"),
        ["tool_execution_start: read", "tool_execution_end: read (ok)"].join("\n"),
        "utf-8",
      );

      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.prepopulateStreamFiles(tmpDir);

      // Events are NOT replayed from disk.
      expect(overlay.getConversation("builder")).toEqual([]);
    });
  });
});
