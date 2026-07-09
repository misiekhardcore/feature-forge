import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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

  describe("statusIcon", () => {
    it("returns ✓ for done with passed: true", () => {
      expect(AgentViewerOverlay.statusIcon("done", true)).toBe("✓");
    });

    it("returns ✓ for done without explicit passed", () => {
      expect(AgentViewerOverlay.statusIcon("done")).toBe("✓");
    });

    it("returns ✗ for done with passed: false", () => {
      expect(AgentViewerOverlay.statusIcon("done", false)).toBe("✗");
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

    it("writes stream events to a filesystem log when executionId and streamDir are configured", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-stream-test-"));
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("exec-1", tmpDir);

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as AgentEvent);

      const tail = overlay.getStreamTail("builder");
      expect(tail).toContain("tool_execution_start: read");
      expect(tail).toContain("message_start: assistant");

      overlay.dispose();
    });

    it("uses executionId as prefix in stream filenames", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-stream-test-"));
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("exec-42", tmpDir);

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      // The file should be named with the executionId prefix.
      const expectedPath = join(tmpDir, "builder.stream");
      expect(existsSync(expectedPath)).toBe(true);

      const content = readFileSync(expectedPath, "utf-8");
      expect(content).toContain("tool_execution_start: read");

      overlay.dispose();
    });

    it("does not write to disk when executionId is not set", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-stream-test-"));
      const overlay = makeOverlay();
      // streamDir set but no executionId
      overlay.setAgentExecutionId("", tmpDir);

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
      overlay.setAgentExecutionId("exec-1", tmpDir);

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      const tail = overlay.getStreamTail("builder");
      expect(tail).toContain("tool_execution_start: read");

      overlay.dispose();
    });

    it("does not throw when streamDir filesystem operations fail", () => {
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("exec-1", "/nonexistent/path/that/should/fail");

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

    it("handles pushStreamEvent with streamDir set but empty executionId gracefully", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-empty-exec-stream-"));
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("", tmpDir);

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

  describe("getStreamTail", () => {
    it("returns empty string when no streamDir was configured", () => {
      const overlay = makeOverlay();
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

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
        overlay.pushStreamEvent("builder", {
          type: "tool_execution_start",
          toolName: `tool-${i}`,
        } as AgentEvent);
      }

      const tail = overlay.getStreamTail("builder", 2);
      const tailLines = tail.split("\n");
      expect(tailLines).toHaveLength(2);
      expect(tailLines[0]).toBe("tool_execution_start: tool-3");
      expect(tailLines[1]).toBe("tool_execution_start: tool-4");

      overlay.dispose();
    });

    it("handles read errors gracefully", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-stream-test-"));
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("exec-1", tmpDir);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      // Remove the stream file to force a read error.
      const filePath = join(tmpDir, "builder.stream");
      rmSync(filePath);

      const tail = overlay.getStreamTail("builder");
      expect(tail).toBe("");

      overlay.dispose();
    });
  });

  describe("setAgentExecutionId", () => {
    it("configures execution id and stream directory", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-stream-test-"));
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("my-exec", tmpDir);

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      expect(overlay.getStreamTail("builder")).toContain("tool_execution_start: read");

      overlay.dispose();
    });

    it("overwrites previous executionId and streamDir when called again", () => {
      const tmpDir1 = mkdtempSync(join(tmpdir(), "forge-overwrite-1-"));
      const tmpDir2 = mkdtempSync(join(tmpdir(), "forge-overwrite-2-"));

      const overlay = makeOverlay();
      overlay.setAgentExecutionId("exec-first", tmpDir1);
      overlay.setAgentExecutionId("exec-second", tmpDir2);

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      // File should be written using the second (overwritten) executionId in tmpDir2.
      const expectedPath = join(tmpDir2, "builder.stream");
      expect(existsSync(expectedPath)).toBe(true);

      // File should NOT be in tmpDir1.
      const oldPath = join(tmpDir1, "builder.stream");
      expect(existsSync(oldPath)).toBe(false);

      overlay.dispose();
    });

    it("sets executionId without streamDir", () => {
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("exec-no-dir");

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      // In-memory should work.
      expect(overlay.getLastStreamLine("builder")).toBe("tool_execution_start: read");
      // No disk file.
      expect(overlay.getStreamTail("builder")).toBe("");
    });

    it("does not write to disk when executionId is empty string", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-empty-exec-"));
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("", tmpDir);

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      // In-memory line should still be recorded.
      expect(overlay.getLastStreamLine("builder")).toBe("tool_execution_start: read");
      // Disk file IS written (executionId prefix removed).
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
      overlay.setAgentExecutionId("exec-1", tmpDir);

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
      overlay.setAgentExecutionId("exec-1", tmpDir);
      overlay.update(makeEntry("builder", "started"));

      overlay.dispose();

      expect(overlay.entryCount).toBe(0);
    });

    it("is safe to call multiple times", () => {
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("exec-1", tmpDir);
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
      overlay.setAgentExecutionId("exec-1", tmpDir);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      overlay.pushStreamEvent("reviewer", {
        type: "tool_execution_start",
        toolName: "lint",
      } as AgentEvent);

      expect(overlay.getLastStreamLine("builder")).toBe("tool_execution_start: read");
      expect(overlay.getStreamTail("builder")).toContain("tool_execution_start: read");

      overlay.dispose();

      // Both in-memory maps are cleared.
      expect(overlay.getLastStreamLine("builder")).toBeUndefined();
      expect(overlay.getStreamTail("builder")).toBe("");
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
      expect(overlay.scrollOffset).toBe(0);
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

    it("shows stream log when streamDir is configured", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-detail-stream-"));
      const overlay = makeOverlay();
      overlay.setAgentExecutionId("exec-detail", tmpDir);
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "write",
      } as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Stream log:");
      expect(joined).toContain("tool_execution_start: read");
      expect(joined).toContain("tool_execution_start: write");

      overlay.dispose();
    });

    it("shows last event line when present", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "done"));
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
      } as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Last event:");
      expect(joined).toContain("message_end: Done.");
    });

    it("shows raw output section when present", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "done", { raw: "Full output here" }));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Raw output:");
      expect(joined).toContain("Full output here");
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

      const tail = overlay.getStreamTail("builder");
      expect(tail).toContain("message_start: assistant");
      expect(tail).toContain("message_end: I will now read the file.");
      expect(tail).toContain("tool_execution_start: read");

      overlay.dispose();
    });

    it("stream file content survives overlay instance lifetime", () => {
      const overlay1 = makeOverlay();
      overlay1.setAgentExecutionId("exec-1", tmpDir);
      overlay1.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);

      const overlay2 = makeOverlay();
      overlay2.setAgentExecutionId("exec-1", tmpDir);
      overlay2.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "write",
      } as AgentEvent);

      const tail = overlay2.getStreamTail("builder");
      // The tail shows lines written via overlay2.
      expect(tail).toContain("tool_execution_start: write");

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
  });
});
