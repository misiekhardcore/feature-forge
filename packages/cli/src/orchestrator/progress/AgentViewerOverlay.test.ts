import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import type { MarkdownTheme, TUI } from "@earendil-works/pi-tui";
import { AgentStatus, jsonParse } from "@feature-forge/shared";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Agent } from "../../agents/agents/Agent";
import type { AgentSpecification } from "../../agents/specifications";
import type { AgentSupervisor } from "../../agents/supervisors/AgentSupervisor";
import { makeMockToolRegistry, makeMockTypedEventBus } from "../../test-utils";
import { AgentDisplayHelpers } from "./AgentDisplayHelpers";
import type { AgentViewerOverlayParams } from "./AgentViewerOverlay";
import { AgentViewerOverlay } from "./AgentViewerOverlay";
import type { AgentViewerEntry } from "./types";

// Re-export constant for test assertions
const MAX_AGENT_EVENTS = 200;

// ── Helpers ──────────────────────────────────────────────────

// Helper: strip ANSI escape codes from a line for assertion purposes.
function stripAnsiForTest(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[\d+m/g, "");
}

beforeAll(() => {
  // pi components (UserMessageComponent, AssistantMessageComponent,
  // ToolExecutionComponent) depend on the pi runtime theme singleton.
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

function makeTui(): TUI {
  return {
    requestRender: vi.fn(),
  } as unknown as TUI;
}

function makeEntry(
  id: string,
  status: string,
  overrides: Record<string, unknown> = {},
): AgentViewerEntry {
  if (status === "started") {
    return { id, status: "started", createdAt: new Date(), ...overrides };
  }
  if (status === "done") {
    return {
      id,
      status: "done",
      createdAt: new Date(),
      passed: false,
      summary: "",
      ...overrides,
    };
  }
  if (status === "error") {
    return {
      id,
      status: "error",
      createdAt: new Date(),
      errorMessage: "",
      ...overrides,
    };
  }
  return { id, status: "started", createdAt: new Date(), ...overrides };
}

function makeOverlay(overrides: Partial<AgentViewerOverlayParams> = {}): AgentViewerOverlay {
  return new AgentViewerOverlay({
    tui: makeTui(),
    theme: makeTheme(),
    onDone: vi.fn(),
    markdownTheme: makeMarkdownTheme(),
    cwd: "/test/cwd",
    toolRegistry: makeMockToolRegistry(),
    ...overrides,
  });
}

// ── Tests ────────────────────────────────────────────────────

describe("AgentViewerOverlay", () => {
  describe("constructor", () => {
    it("starts with zero entries", () => {
      const overlay = makeOverlay();
      expect(overlay.entryCount).toBe(0);
    });

    it("accepts tui, theme, onDone, markdownTheme, and cwd", () => {
      const tui = makeTui();
      const theme = makeTheme();
      const onDone = vi.fn();
      const markdownTheme = makeMarkdownTheme();
      const overlay = new AgentViewerOverlay({
        tui,
        theme,
        onDone,
        markdownTheme,
        cwd: "/custom/cwd",
        toolRegistry: makeMockToolRegistry(),
      });

      expect(overlay.entryCount).toBe(0);

      // Verify the overlay functions correctly with custom params.
      overlay.update({ id: "builder", status: "started", createdAt: new Date() });
      expect(overlay.entryCount).toBe(1);

      // Verify event processing and rendering work with non-default theme values.
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as unknown as AgentEvent);
      const lines = overlay.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("builder");
      expect(joined).toContain("tool_execution_start: read");
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
      overlay.update(makeEntry("builder", "done", { passed: true, summary: "Built successfully" }));

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

    it("shows summary as description when no stream event present", () => {
      const overlay = makeOverlay();
      overlay.update(
        makeEntry("builder", "done", {
          raw: "output line 1\noutput line 2",
          summary: "Build complete",
        }),
      );

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      // SelectList uses summary as description when no last stream line exists.
      expect(joined).toContain("Build complete");
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
      } as unknown as AgentEvent);

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("tool_execution_start: read");
      expect(joined).toContain("⟳");
    });

    it("shows last stream line as description for done agents", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "done", { passed: true, summary: "Build passed" }));
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as unknown as AgentEvent);

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      // SelectList shows last stream line as description; summary is not separately rendered.
      expect(joined).toContain("tool_execution_start: read");
    });

    it("does not truncate short last stream lines", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      const shortLine = "tool_execution_start: read";
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as unknown as AgentEvent);

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain(shortLine);
      expect(joined).not.toContain("...");
    });

    it("shows summary as description when both summary and raw are provided", () => {
      const overlay = makeOverlay();
      overlay.update(
        makeEntry("builder", "done", { summary: "Build passed", raw: "Full output here" }),
      );

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      // SelectList uses summary as description — rendered as part of the compact line.
      expect(joined).toContain("Build passed");
    });

    it("handles zero width gracefully", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));

      const lines = overlay.render(0);

      expect(lines).toBeInstanceOf(Array);
      // Should not throw.
    });
  });

  describe("border rendering (addBorder)", () => {
    it("applies border theme color to border characters", () => {
      const theme = makeTheme();
      const overlay = makeOverlay({ theme });
      overlay.update(makeEntry("builder", "started"));

      overlay.render(60);

      // BorderedContainer uses "border" for border styling.
      expect(theme.fg).toHaveBeenCalledWith("border", expect.stringMatching(/^[┌└]/));
    });

    it("applies 1-column left margin — space after opening │", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));

      const lines = overlay.render(60);
      // Strip ANSI codes so the raw content between border chars is visible.
      const cleanLines = lines.map(stripAnsiForTest);
      const contentLine = cleanLines.find((l) => l.includes("→") || l.includes("no agents"));
      expect(contentLine).toBeDefined();
      if (contentLine) {
        const afterLeftBorder = contentLine.indexOf("│") + 1;
        expect(contentLine[afterLeftBorder]).toBe(" ");
      }
    });

    it("applies 1-column right margin — space before closing │", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));

      const lines = overlay.render(60);
      const cleanLines = lines.map(stripAnsiForTest);
      const contentLine = cleanLines.find((l) => l.includes("→") || l.includes("no agents"));
      expect(contentLine).toBeDefined();
      if (contentLine) {
        const lastPipe = contentLine.lastIndexOf("│");
        expect(contentLine[lastPipe - 1]).toBe(" ");
      }
    });

    it("includes a blank margin line between top border and content", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));

      const lines = overlay.render(60);
      // Second line (index 1) should be the top margin blank line.
      const marginLine = lines[1];
      // It should have │ with only spaces between them (margin + padding).
      const clean = stripAnsiForTest(marginLine);
      expect(clean).toMatch(/^│ +│$/);
    });

    it("includes a blank margin line between content and bottom border", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));

      const lines = overlay.render(60);
      // Second-to-last line should be the bottom margin blank line.
      const marginLine = lines[lines.length - 2];
      const clean = stripAnsiForTest(marginLine);
      expect(clean).toMatch(/^│ +│$/);
    });

    it("renders correctly with zero width and does not throw", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));

      expect(() => overlay.render(0)).not.toThrow();
      const lines = overlay.render(0);
      expect(lines).toBeInstanceOf(Array);
    });

    it("renders detail view with border margin structure", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("test-agent", "done", { summary: "Completed" }));

      // Navigate to detail view.
      overlay.handleInput("\r");

      const lines = overlay.render(60);
      const cleanLines = lines.map(stripAnsiForTest);
      expect(cleanLines[0]).toContain("┌");
      expect(cleanLines[cleanLines.length - 1]).toContain("└");
      // Blank margin lines in detail view too.
      expect(cleanLines[1]).toMatch(/^│ +│$/);
      expect(cleanLines[cleanLines.length - 2]).toMatch(/^│ +│$/);
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
      overlay.update(makeEntry("builder", "done", { passed: true, summary: "Build passed" }));

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
      } as unknown as AgentEvent);

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
      const result = AgentDisplayHelpers.formatElapsed(recent);
      expect(result).toMatch(/^\d+s$/);
    });

    it("formats minutes and seconds when less than an hour", () => {
      const now = Date.now();
      const recent = new Date(now - 120 * 1000);
      const result = AgentDisplayHelpers.formatElapsed(recent);
      expect(result).toMatch(/^\d+m \d+s$/);
    });

    it("formats hours when elapsed exceeds one hour", () => {
      const now = Date.now();
      const old = new Date(now - 4000 * 1000);
      const result = AgentDisplayHelpers.formatElapsed(old);
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
      } as unknown as AgentEvent);
      expect(line).toBe("tool_execution_start: read");
    });

    it("includes serialized args in tool_execution_start stream line", () => {
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "tool_execution_start",
        toolName: "bash",
        args: { command: "ls -la" },
      } as unknown as AgentEvent);
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
      } as unknown as AgentEvent);
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
      } as unknown as AgentEvent);
      expect(line).toBe("tool_execution_end: tool (ok)");
    });

    it("formats tool_execution_end with error status", () => {
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "tool_execution_end",
        toolName: "tool",
        isError: true,
      } as unknown as AgentEvent);
      expect(line).toBe("tool_execution_end: tool (error)");
    });

    it("formats message_start with nested message role", () => {
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "message_start",
        message: { role: "assistant" },
      } as unknown as AgentEvent);
      expect(line).toBe("message_start: assistant");
    });

    it("formats message_end with content text blocks", () => {
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Here is the result." }],
        },
      } as unknown as AgentEvent);
      expect(line).toBe("message_end: Here is the result.");
    });

    it("formats agent_start as 'started'", () => {
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "agent_start",
      } as unknown as AgentEvent);
      expect(line).toBe("agent_start: started");
    });

    it("formats agent_end as 'completed'", () => {
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "agent_end",
      } as unknown as AgentEvent);
      expect(line).toBe("agent_end: completed");
    });

    it("formats turn_start and turn_end", () => {
      expect(
        AgentViewerOverlay.formatStreamEvent({ type: "turn_start" } as unknown as AgentEvent),
      ).toBe("turn_start: turn start");
      expect(
        AgentViewerOverlay.formatStreamEvent({ type: "turn_end" } as unknown as AgentEvent),
      ).toBe("turn_end: turn end");
    });

    it("formats tool_execution_update with partial result", () => {
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "tool_execution_update",
        toolName: "read",
        partialResult: "Reading file...",
      } as unknown as AgentEvent);
      expect(line).toBe("tool_execution_update: read: Reading file...");
    });

    it("formats message_update with content text", () => {
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "message_update",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "I am thinking..." }],
        },
      } as unknown as AgentEvent);
      expect(line).toBe("message_update: I am thinking...");
    });

    it("returns just the type for events with no known detail", () => {
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "unknown_type",
      } as unknown as AgentEvent);
      expect(line).toBe("unknown_type");
    });

    it("formats tool_execution_update with object partialResult", () => {
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "tool_execution_update",
        toolName: "read",
        partialResult: { key: "value" },
      } as unknown as AgentEvent);
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
      } as unknown as AgentEvent);

      expect(overlay.getLastStreamLine("builder")).toBe("tool_execution_start: read");
    });

    it("overwrites previous last line for the same agent", () => {
      const overlay = makeOverlay();
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "write",
      } as unknown as AgentEvent);

      expect(overlay.getLastStreamLine("builder")).toBe("tool_execution_start: write");
    });

    it("tracks last lines per agent independently", () => {
      const overlay = makeOverlay();
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("reviewer", {
        type: "tool_execution_start",
        toolName: "lint",
      } as unknown as AgentEvent);

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
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as unknown as AgentEvent);

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
      } as unknown as AgentEvent);

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
      } as unknown as AgentEvent);

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
      } as unknown as AgentEvent);

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
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "write",
      } as unknown as AgentEvent);

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
        } as unknown as AgentEvent);
      }).not.toThrow();

      expect(overlay.getLastStreamLine("builder")).toBe("tool_execution_start: read");

      overlay.dispose();
    });

    it("pushes event for an agent not yet added via update", () => {
      const overlay = makeOverlay();

      overlay.pushStreamEvent("unknown-agent", {
        type: "tool_execution_start",
        toolName: "read",
      } as unknown as AgentEvent);

      expect(overlay.getLastStreamLine("unknown-agent")).toBe("tool_execution_start: read");
      expect(overlay.lastStreamLine).toBe("tool_execution_start: read");
    });

    it("requests render when pushing an event", () => {
      const tui = makeTui();
      const overlay = makeOverlay({ tui });

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as unknown as AgentEvent);

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
        } as unknown as AgentEvent);
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
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("reviewer", {
        type: "tool_execution_start",
        toolName: "lint",
      } as unknown as AgentEvent);

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
      } as unknown as AgentEvent);
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
      } as unknown as AgentEvent);

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
      } as unknown as AgentEvent);

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
      } as unknown as AgentEvent);

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
      } as unknown as AgentEvent);

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
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("reviewer", {
        type: "tool_execution_start",
        toolName: "lint",
      } as unknown as AgentEvent);

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
      const overlay = makeOverlay({ tui, onDone });

      overlay.handleInput("\x1b");

      expect(onDone).toHaveBeenCalledTimes(1);
      expect(tui.requestRender).not.toHaveBeenCalled();
    });

    it("returns to list view when Escape is pressed in detail view", () => {
      const tui = makeTui();
      const onDone = vi.fn();
      const overlay = makeOverlay({ tui, onDone });
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
      const overlay = makeOverlay({ tui });
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
      const overlay = makeOverlay({ tui });
      overlay.update(makeEntry("agent-a", "started"));
      overlay.update(makeEntry("agent-b", "started"));
      // Render first to ensure SelectList is initialized.
      overlay.render(80);
      overlay.selectedIndex = 1;

      // Simulate ArrowDown at last item — SelectList wraps to top.
      overlay.handleInput("\x1b[B");

      expect(overlay.selectedIndex).toBe(0);
    });

    it("navigates up with ArrowUp in list view", () => {
      const tui = makeTui();
      const overlay = makeOverlay({ tui });
      overlay.update(makeEntry("agent-a", "started"));
      overlay.update(makeEntry("agent-b", "started"));
      // Render first to ensure SelectList is initialized.
      overlay.render(80);
      overlay.selectedIndex = 1;

      // Simulate ArrowUp
      overlay.handleInput("\x1b[A");

      expect(overlay.selectedIndex).toBe(0);
    });

    it("wraps around at the top with ArrowUp", () => {
      const tui = makeTui();
      const overlay = makeOverlay({ tui });
      overlay.update(makeEntry("agent-a", "started"));
      overlay.update(makeEntry("agent-b", "started"));

      // Simulate ArrowUp at first item
      overlay.handleInput("\x1b[A");

      expect(overlay.selectedIndex).toBe(1);
    });

    it("enters detail view on Enter", () => {
      const tui = makeTui();
      const overlay = makeOverlay({ tui });
      overlay.update(makeEntry("agent-a", "started"));
      overlay.update(makeEntry("agent-b", "started"));
      // Render first to ensure SelectList is initialized with correct index.
      overlay.render(80);
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
      const overlay = makeOverlay({ tui });
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
      const overlay = makeOverlay({ tui });
      overlay.update(makeEntry("builder", "done"));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      overlay.scrollOffset = 0;

      overlay.handleInput("\x1b[A");

      expect(overlay.scrollOffset).toBe(0);
    });

    it("scrolls down in detail view with ArrowDown", () => {
      const tui = makeTui();
      const overlay = makeOverlay({ tui });
      overlay.update(makeEntry("builder", "done"));
      // Push enough events to exceed viewport height (fallback=20).
      for (let i = 0; i < 25; i++) {
        overlay.pushStreamEvent("builder", {
          type: "message_start",
          message: {
            role: "user",
            content: [{ type: "text", text: `line ${i}` }],
            timestamp: Date.now(),
          },
        });
        overlay.pushStreamEvent("builder", {
          type: "message_end",
          message: {
            role: "user",
            content: [{ type: "text", text: `line ${i}` }],
            timestamp: Date.now(),
          },
        });
      }
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

      expect(joined).toContain("→");
      // Only one → should appear (one selected item).
      const cursorCount = (joined.match(/→/g) || []).length;
      expect(cursorCount).toBe(1);
    });

    it("shows scroll info footer when items exceed visible area", () => {
      const overlay = makeOverlay();
      // Add enough entries to trigger scroll info — SelectList shows "(N/M)" only
      // when items exceed maxVisible (15).
      for (let i = 0; i < 20; i++) {
        overlay.update(makeEntry(`agent-${i}`, "started"));
      }

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      // SelectList renders scroll info like "(N/M)".
      expect(joined).toContain("(1/20)");
    });

    it("renders selected item with selection prefix", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("agent-a", "started"));
      overlay.update(makeEntry("agent-b", "started"));
      overlay.selectedIndex = 0;

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      // SelectList renders selected item with "→ " prefix.
      expect(joined).toContain("→");
      expect(joined).toContain("agent-a");
    });
  });

  describe("detail rendering", () => {
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
      overlay.update(makeEntry("builder", "done", { passed: true, summary: "Build passed" }));
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
      overlay.update(makeEntry("builder", "done", { passed: true, summary: "Build passed" }));
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
        type: "message_start",
        message: { role: "assistant", content: [] },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "read",
        isError: false,
        result: "file contents",
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "file contents" }],
        },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant", content: [] },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "write",
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "write",
        isError: false,
        result: "written",
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "written" }],
        },
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Conversation:");
      expect(joined).not.toContain("Stream log:");

      expect(joined).not.toContain("Stream log:");

      overlay.dispose();
    });

    it("shows assistant message turn in conversation", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "done"));
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "Done." }] },
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Conversation:");
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
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: {},
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: { content: [{ type: "text", text: "No role here." }] },
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("No role here.");
    });

    it("shows tool name for tool call from typed event", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      // Tool execution events without a wrapping message produce no
      // AgentMessage entries, so the conversation shows no content.
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "bash",
        toolCallId: "call-1",
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "bash",
        toolCallId: "call-1",
        isError: false,
        result: "done",
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Conversation:");
      expect(joined).toContain("No conversation recorded.");
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
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: shortContent }],
        },
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain(shortContent);
    });

    it("renders detail view for unknown status agent", () => {
      const overlay = makeOverlay();
      overlay.update(
        makeEntry("unknown-agent", "error", {
          errorMessage: "agent disconnected",
          summary: "Agent disconnected",
        }),
      );
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "unknown-agent";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("unknown-agent");
      expect(joined).toContain("error");
    });

    it("renders tool call result with done status in detail", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as unknown as AgentEvent);
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

      // pi ToolExecutionComponent formats the result with its own style.
      expect(joined).toContain("Conversation:");
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

    it("renders detail content when viewMode is detail", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "done", { passed: true, summary: "Build passed" }));
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
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "I will now read the file." }],
        },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as unknown as AgentEvent);

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
      } as unknown as AgentEvent);

      const overlay2 = makeOverlay();
      overlay2.setStreamDir(tmpDir);
      overlay2.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "write",
      } as unknown as AgentEvent);

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
      const eventBus = makeMockTypedEventBus();
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
          executionId: "exec-1",
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
      const eventBus = makeMockTypedEventBus();
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
          executionId: "exec-1",
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
      const eventBus = makeMockTypedEventBus();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        supervisor,
      });

      // Emit events BEFORE connect — they should be buffered.
      eventBus.emit("feature-forge:agent-started", {
        phase: "agent-started",
        message: 'Agent "builder" started',
        details: { executionId: "exec-1", agentId: "builder" },
      });
      eventBus.emit("feature-forge:agent-stream", {
        phase: "agent-stream",
        message: 'Agent "builder" stream event',
        details: {
          executionId: "exec-1",
          label: "builder",
          agentId: "builder",
          event: { type: "tool_execution_start", toolCallId: "call-1", toolName: "read", args: {} },
        },
      });
      eventBus.emit("feature-forge:agent-done", {
        phase: "agent-done",
        message: 'Agent "builder" completed',
        details: {
          executionId: "exec-1",
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
      const eventBus = makeMockTypedEventBus();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        supervisor,
      });

      const overlay = makeOverlay();
      connect(overlay, "");

      // The running agent should show ⟳ (no passed concept for started).
      const lines = overlay.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("⟳");

      unsubs.forEach((u) => u());
      overlay.dispose();
    });

    it("ignores events without agentId in details", () => {
      const supervisor = makeMockSupervisor();
      const eventBus = makeMockTypedEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        supervisor,
      });

      connect(overlay, "");

      // Emit an event without agentId via raw bus — should be silently ignored.
      expect(() => {
        eventBus.raw.emit("feature-forge:agent-done", {
          phase: "agent-done",
          message: "no agent id",
          details: { executionId: "exec-1" },
        });
      }).not.toThrow();

      expect(overlay.entryCount).toBe(0);

      unsubs.forEach((u) => u());
      overlay.dispose();
    });

    it("calls pushStreamEvent for stream events after connect", () => {
      const agent = makeMockAgent("builder", "builder", AgentStatus.Running);
      const supervisor = makeMockSupervisor([agent]);
      const eventBus = makeMockTypedEventBus();
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
          executionId: "exec-1",
          label: "builder",
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
        const eventBus = makeMockTypedEventBus();
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
            executionId: "exec-1",
            label: "builder",
            agentId: "builder",
            event: {
              type: "tool_execution_start",
              toolCallId: "call-1",
              toolName: "read",
              args: {},
            },
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
      const eventBus = makeMockTypedEventBus();

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
      const eventBus = makeMockTypedEventBus();
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
          executionId: "exec-1",
          label: "builder",
          agentId: "builder",
          event: {
            type: "tool_execution_start",
            toolCallId: "call-1",
            toolName: "read",
            args: {},
          },
        },
      });

      // The stream line should not have been updated after unsub.
      expect(overlay.getLastStreamLine("builder")).toBeUndefined();

      unsubs.slice(1).forEach((u) => u());
      overlay.dispose();
    });

    it("uses fallback summary when getAgent returns undefined after connect", () => {
      const supervisor = makeMockSupervisor([]);
      const eventBus = makeMockTypedEventBus();
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
          executionId: "exec-1",
          agentId: "orphan",
          passed: true,
          summary: "Agent disconnected",
        },
      });

      connect(overlay, "");

      const lines = overlay.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("orphan");
      expect(joined).toContain("⟳");
      expect(joined).toContain("Agent disconnected");

      unsubs.forEach((u) => u());
      overlay.dispose();
    });

    it("handles agent-started event after connect", () => {
      const agent = makeMockAgent("builder", "builder", AgentStatus.Running);
      const supervisor = makeMockSupervisor([agent]);
      const eventBus = makeMockTypedEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        supervisor,
      });

      connect(overlay, "");

      eventBus.emit("feature-forge:agent-started", {
        phase: "agent-started",
        message: 'Agent "builder" started',
        details: { executionId: "exec-1", agentId: "builder" },
      });

      const lines = overlay.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("⟳");
      expect(joined).toContain("builder");

      unsubs.forEach((u) => u());
      overlay.dispose();
    });

    it("falls back to 'Agent disconnected' summary when no agent found and no event summary", () => {
      const supervisor = makeMockSupervisor([]);
      const eventBus = makeMockTypedEventBus();
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
        details: { executionId: "exec-1", agentId: "orphan" },
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
      const eventBus = makeMockTypedEventBus();
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
        details: { executionId: "exec-1", agentId: "builder" },
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
      const eventBus = makeMockTypedEventBus();
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
          details: {
            executionId: "exec-1",
            agentId: "builder",
            label: "builder",
            event: undefined as unknown as AgentEvent,
          },
        });
      }).not.toThrow();

      // No stream line should be recorded.
      expect(overlay.getLastStreamLine("builder")).toBeUndefined();

      unsubs.forEach((u) => u());
      overlay.dispose();
    });

    it("buffers agent-stream event without event in details (no-op)", () => {
      const supervisor = makeMockSupervisor([]);
      const eventBus = makeMockTypedEventBus();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        supervisor,
      });

      // Emit agent-stream without event details BEFORE connect.
      eventBus.emit("feature-forge:agent-stream", {
        phase: "agent-stream",
        message: 'Agent "builder" stream',
        details: {
          executionId: "exec-1",
          agentId: "builder",
          label: "builder",
          event: {} as AgentEvent,
        },
      });

      const overlay = makeOverlay();
      connect(overlay, "");

      // No stream line should be recorded.
      expect(overlay.getLastStreamLine("builder")).toBeUndefined();

      unsubs.forEach((u) => u());
      overlay.dispose();
    });

    it("persists buffered events to disk when connect sets streamDir before replay", () => {
      const streamDir = mkdtempSync(join(tmpdir(), "forge-buf-persist-"));
      try {
        const agent = makeMockAgent("builder", "builder", AgentStatus.Running);
        const supervisor = makeMockSupervisor([agent]);
        const eventBus = makeMockTypedEventBus();
        const overlay = makeOverlay();

        const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
          eventBus,
          supervisor,
        });

        // Emit events BEFORE connect — they should be buffered.
        eventBus.emit("feature-forge:agent-stream", {
          phase: "agent-stream",
          message: 'Agent "builder" stream event',
          details: {
            executionId: "exec-1",
            label: "builder",
            agentId: "builder",
            event: {
              type: "tool_execution_start",
              toolCallId: "call-1",
              toolName: "read",
              args: {},
            },
          },
        });

        // Connect with streamDir — buffered events should be persisted.
        connect(overlay, streamDir);

        // Verify buffered event was written to disk.
        expect(existsSync(join(streamDir, "builder.stream"))).toBe(true);
        const streamContent = readFileSync(join(streamDir, "builder.stream"), "utf-8");
        expect(streamContent).toContain("tool_execution_start: read");

        expect(existsSync(join(streamDir, "builder.events.jsonl"))).toBe(true);
        const eventsContent = readFileSync(join(streamDir, "builder.events.jsonl"), "utf-8");
        expect(eventsContent).toContain("tool_execution_start");

        unsubs.forEach((u) => u());
        overlay.dispose();
      } finally {
        rmSync(streamDir, { recursive: true, force: true });
      }
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
        void overlay.prepopulateStreamFiles(tmpDir);

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
        void overlay.prepopulateStreamFiles(tmpDir);

        // The tracked agent should still be "started" (not overwritten).
        const lines = overlay.render(80);
        const joined = lines.join("\n");
        expect(joined).toContain("⟳");
        expect(joined).toContain("builder");

        // The orphaned stream file should create a "done" entry.
        expect(joined).toContain("reviewer");
        expect(joined).toContain("✗");
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
        void overlay.prepopulateStreamFiles(tmpDir);

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
        void overlay.prepopulateStreamFiles("/nonexistent/path/streams");
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
        void overlay.prepopulateStreamFiles(tmpDir);

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
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "I am processing." }],
        },
      } as unknown as AgentEvent);

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
      } as unknown as AgentEvent);
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
      } as unknown as AgentEvent);
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
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_update",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "partial" }],
        },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_update",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "final content" }],
        },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "final content" }],
        },
      } as unknown as AgentEvent);

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
      } as unknown as AgentEvent);
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
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "I will read the file." }],
        },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "read",
        isError: false,
        result: "file contents",
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "The file says hello." }],
        },
      } as unknown as AgentEvent);

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
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Building..." }],
        },
      } as unknown as AgentEvent);

      overlay.pushStreamEvent("reviewer", {
        type: "message_start",
        message: { role: "assistant" },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("reviewer", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Reviewing..." }],
        },
      } as unknown as AgentEvent);

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
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello." }],
        },
      } as unknown as AgentEvent);

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
      } as unknown as AgentEvent);

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
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_update",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "builder partial" }],
        },
      } as unknown as AgentEvent);

      overlay.pushStreamEvent("reviewer", {
        type: "message_start",
        message: { role: "assistant" },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("reviewer", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "reviewer done" }],
        },
      } as unknown as AgentEvent);

      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "builder done" }],
        },
      } as unknown as AgentEvent);

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
      } as unknown as AgentEvent);

      overlay.pushStreamEvent("reviewer", {
        type: "tool_execution_start",
        toolName: "lint",
      } as unknown as AgentEvent);
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
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello." }],
        },
      } as unknown as AgentEvent);

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
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Processing" }],
        },
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Conversation:");
      expect(joined).toContain("Processing");
    });

    it("renders user-role message with UserMessageComponent", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "user" },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "user",
          content: [{ type: "text", text: "Build the project" }],
        },
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Conversation:");
      expect(joined).toContain("Build the project");
    });

    it("renders tool call in conversation", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "call-1", name: "read", arguments: {} }],
        },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
        toolCallId: "call-1",
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "read",
        toolCallId: "call-1",
        isError: false,
        result: "ok output",
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "ok output" }],
        },
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Conversation:");
    });

    it("renders tool call with error result", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "call-1", name: "failing", arguments: {} }],
        },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "failing",
        toolCallId: "call-1",
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "failing",
        toolCallId: "call-1",
        isError: true,
        result: "error message",
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "error message" }],
        },
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Conversation:");
    });

    it("renders running tool call with ⟳ icon", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      // Tool execution events without a wrapping message produce no
      // AgentMessage entries, so the conversation shows no content.
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "long-running",
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Conversation:");
      expect(joined).toContain("No conversation recorded.");
    });

    it("renders tool execution updates in conversation", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "call-1", name: "read", arguments: {} }],
        },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
        toolCallId: "call-1",
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_update",
        toolName: "read",
        toolCallId: "call-1",
        partialResult: "partial content",
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "read",
        toolCallId: "call-1",
        isError: false,
        result: "final content",
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "final content" }],
        },
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Conversation:");
    });

    it("renders mixed conversation with messages and tool calls", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "done"));

      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Let me read." }],
        },
      } as unknown as AgentEvent);

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "read",
        isError: false,
        result: "contents",
      } as unknown as AgentEvent);

      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Done reading." }],
        },
      } as unknown as AgentEvent);

      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Conversation:");
      expect(joined).toContain("Let me read.");
      expect(joined).toContain("Done reading.");
    });

    it("shows tool call conversation section in detail", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      // Tool execution events without a wrapping message produce no
      // AgentMessage entries, so the conversation shows no content.
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as unknown as AgentEvent);
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

      expect(joined).toContain("Conversation:");
      expect(joined).toContain("No conversation recorded.");
    });

    it("does not show flat stream log or last event sections", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as unknown as AgentEvent);
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
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      // message_end without prior start adds the message to the list and
      // renders it since the message carries content.
      expect(joined).toContain("Conversation:");
      expect(joined).toContain("Direct end without start.");
    });
  });

  describe("detail view scrolling with conversation content", () => {
    it("scrolls down through conversation turns", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));

      // Push several conversation turns to create scrollable content.
      for (let i = 0; i < 10; i++) {
        overlay.pushStreamEvent("builder", {
          type: "message_start",
          message: { role: "assistant", content: [] },
        } as unknown as AgentEvent);
        overlay.pushStreamEvent("builder", {
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: `Turn ${i} content` }],
          },
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
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello." }],
        },
      } as unknown as AgentEvent);
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
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Short." }],
        },
      } as unknown as AgentEvent);

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
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hi" }],
        },
      } as unknown as AgentEvent);

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
      expect(overlay.scrollOffset).toBeLessThan(20);
    });

    it("computes max scroll bound from conversation content", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));

      // Push many turns to create scrollable content exceeding viewport height.
      for (let i = 0; i < 20; i++) {
        overlay.pushStreamEvent("builder", {
          type: "message_start",
          message: { role: "assistant", content: [] },
        } as unknown as AgentEvent);
        overlay.pushStreamEvent("builder", {
          type: "message_end",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: `Turn ${i} line 1\nTurn ${i} line 2\nTurn ${i} line 3` },
            ],
          },
        } as unknown as AgentEvent);
      }

      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      // Render at least once to compute scroll bounds.
      overlay.render(80);

      // ArrowDown from 0 should increment by 1.
      overlay.scrollOffset = 0;
      overlay.handleInput("\x1b[B");
      expect(overlay.scrollOffset).toBe(1);
    });
  });

  describe("conversation content rendering", () => {
    it("renders bold text in message content", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "This is **bold** text." }],
        },
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("bold");
    });

    it("renders italic text in message content", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "This is *italic* text." }],
        },
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("italic");
    });

    it("renders inline code in message content", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Use `npm test` to verify." }],
        },
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      // The Markdown component renders inline code without backticks.
      expect(joined).toContain("npm test");
    });

    it("renders message content with blank lines", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "\n\nHello\n\n" }],
        },
      } as unknown as AgentEvent);
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
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello" }],
        },
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      overlay.autoScroll = false;
      // Set scrollOffset past the max — ArrowDown will clamp to max and resume auto-scroll.
      overlay.scrollOffset = 999999;

      overlay.handleInput("\x1b[B");
      // Render clamps scrollOffset and sets autoScroll when at bottom.
      overlay.render(80);

      expect(overlay.autoScroll).toBe(true);
    });

    it("does not resume auto-scroll on ArrowDown when not at bottom", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      // Push enough events to exceed viewport height (fallback=20).
      for (let i = 0; i < 25; i++) {
        overlay.pushStreamEvent("builder", {
          type: "message_start",
          message: { role: "user", content: [{ type: "text", text: `line ${i}` }] },
        } as unknown as AgentEvent);
        overlay.pushStreamEvent("builder", {
          type: "message_end",
          message: { role: "user", content: [{ type: "text", text: `line ${i}` }] },
        } as unknown as AgentEvent);
      }
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
      // Push enough events to exceed viewport height (fallback=20).
      for (let i = 0; i < 25; i++) {
        overlay.pushStreamEvent("builder", {
          type: "message_start",
          message: { role: "user", content: [{ type: "text", text: `line ${i}` }] },
        } as unknown as AgentEvent);
        overlay.pushStreamEvent("builder", {
          type: "message_end",
          message: { role: "user", content: [{ type: "text", text: `line ${i}` }] },
        } as unknown as AgentEvent);
      }
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      overlay.autoScroll = true;

      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as unknown as AgentEvent);

      // Should have scrolled to bottom (past zero).
      expect(overlay.scrollOffset).toBeGreaterThan(0);
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
      } as unknown as AgentEvent);

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
        type: "message_start",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call-1",
              name: "bash",
              arguments: { command: "ls" },
            },
          ],
        },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "bash",
        toolCallId: "call-1",
        args: { command: "ls" },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "bash",
        toolCallId: "call-1",
        isError: false,
        result: "file1\nfile2",
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "file1\nfile2" }],
        },
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Conversation:");
    });

    it("renders toolArgs result with tool content in detail view", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call-1",
              name: "bash",
              arguments: { command: "cat" },
            },
          ],
        },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "bash",
        toolCallId: "call-1",
        args: { command: "cat" },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_end",
        toolName: "bash",
        toolCallId: "call-1",
        isError: false,
        result: "file.txt",
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "file.txt" }],
        },
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Conversation:");
    });

    it("renders tool without result when running", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      // Tool execution events without a wrapping message produce no
      // AgentMessage entries, so the conversation shows no content.
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "bash",
        args: { command: "sleep 10" },
      } as unknown as AgentEvent);
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Conversation:");
      expect(joined).toContain("No conversation recorded.");
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
      void overlay.prepopulateStreamFiles(tmpDir);

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
      void overlay.prepopulateStreamFiles(tmpDir);

      // Events are NOT replayed from disk.
      expect(overlay.getConversation("builder")).toEqual([]);
    });
  });

  describe("in-memory sliding window cap", () => {
    it("caps per-agent event buffer at MAX_AGENT_EVENTS with FIFO eviction", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));

      // Push MAX_AGENT_EVENTS + 1 events.
      for (let index = 0; index < MAX_AGENT_EVENTS + 1; index++) {
        overlay.pushStreamEvent("builder", {
          type: "message_start",
          message: { role: "assistant" },
        } as unknown as AgentEvent);
      }

      const events = overlay.getConversation("builder");
      expect(events).toHaveLength(MAX_AGENT_EVENTS);
    });

    it("evicts oldest events first (FIFO)", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));

      // Push MAX_AGENT_EVENTS events with distinct content.
      for (let index = 0; index < MAX_AGENT_EVENTS; index++) {
        overlay.pushStreamEvent("builder", {
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: `event-${index}` }],
          },
        } as unknown as AgentEvent);
      }

      // Push one more; event-0 should be evicted.
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "event-overflow" }],
        },
      } as unknown as AgentEvent);

      const events = overlay.getConversation("builder");
      expect(events).toHaveLength(MAX_AGENT_EVENTS);
      // The first event should now be event-1 (event-0 was evicted).
      const firstContent = (
        events[0] as unknown as { message: { content: Array<{ text: string }> } }
      ).message.content[0].text;
      expect(firstContent).toBe("event-1");
      // The last event should be the overflow one.
      const lastContent = (
        events[events.length - 1] as unknown as { message: { content: Array<{ text: string }> } }
      ).message.content[0].text;
      expect(lastContent).toBe("event-overflow");
    });

    it("caps each agent independently", () => {
      const overlay = makeOverlay();

      // Push MAX_AGENT_EVENTS + 10 to agent-a.
      for (let index = 0; index < MAX_AGENT_EVENTS + 10; index++) {
        overlay.pushStreamEvent("agent-a", {
          type: "message_start",
          message: { role: "assistant" },
        } as unknown as AgentEvent);
      }

      // Push only 5 to agent-b.
      for (let index = 0; index < 5; index++) {
        overlay.pushStreamEvent("agent-b", {
          type: "message_start",
          message: { role: "assistant" },
        } as unknown as AgentEvent);
      }

      expect(overlay.getConversation("agent-a")).toHaveLength(MAX_AGENT_EVENTS);
      expect(overlay.getConversation("agent-b")).toHaveLength(5);
    });
  });

  describe("JSONL persistence", () => {
    it("writes raw events as JSONL to .events.jsonl file", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-jsonl-test-"));
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as unknown as AgentEvent);

      const jsonlPath = join(tmpDir, "builder.events.jsonl");
      expect(existsSync(jsonlPath)).toBe(true);

      const content = readFileSync(jsonlPath, "utf-8");
      const lines = content.trimEnd().split("\n");
      expect(lines).toHaveLength(1);
      const parsed = jsonParse<AgentEvent>(lines[0]);
      expect(parsed.type).toBe("message_start");

      overlay.dispose();
    });

    it("appends multiple events as separate JSON lines", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-jsonl-append-"));
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as unknown as AgentEvent);

      const jsonlPath = join(tmpDir, "builder.events.jsonl");
      const content = readFileSync(jsonlPath, "utf-8");
      const lines = content.trimEnd().split("\n");
      expect(lines).toHaveLength(2);
      expect(jsonParse<AgentEvent>(lines[0]).type).toBe("message_start");
      expect(jsonParse<AgentEvent>(lines[1]).type).toBe("tool_execution_start");

      overlay.dispose();
    });

    it("writes per-agent JSONL files independently", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-jsonl-multi-"));
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      overlay.pushStreamEvent("agent-a", {
        type: "message_start",
        message: { role: "assistant" },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("agent-b", {
        type: "tool_execution_start",
        toolName: "read",
      } as unknown as AgentEvent);

      expect(existsSync(join(tmpDir, "agent-a.events.jsonl"))).toBe(true);
      expect(existsSync(join(tmpDir, "agent-b.events.jsonl"))).toBe(true);

      overlay.dispose();
    });

    it("does not throw when JSONL write fails", () => {
      const overlay = makeOverlay();
      overlay.setStreamDir("/nonexistent/path/that/should/fail");

      expect(() => {
        overlay.pushStreamEvent("builder", {
          type: "message_start",
          message: { role: "assistant" },
        } as unknown as AgentEvent);
      }).not.toThrow();

      overlay.dispose();
    });
  });

  describe("loadConversationEvents", () => {
    it("loads events from JSONL file when streamDir is configured", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-load-events-"));
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as unknown as AgentEvent);

      const events = await overlay.loadConversationEvents("builder");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("message_start");

      overlay.dispose();
    });

    it("returns in-memory events when no JSONL file exists", async () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as unknown as AgentEvent);

      const events = await overlay.loadConversationEvents("builder");
      expect(events).toHaveLength(1);
    });

    it("returns empty array for unknown agent with no JSONL", async () => {
      const overlay = makeOverlay();
      const events = await overlay.loadConversationEvents("unknown");
      expect(events).toHaveLength(0);
    });

    it("loads events from disk when count exceeds in-memory window", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-load-count-"));
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      // Sync-write 10 events to JSONL so they're definitely on disk.
      const jsonlPath = join(tmpDir, "builder.events.jsonl");
      for (let index = 0; index < 10; index++) {
        writeFileSync(
          jsonlPath,
          JSON.stringify({ type: "message_start", message: { role: "assistant" } }) + "\n",
          { flag: "a" },
        );
      }
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as unknown as AgentEvent);

      // 10 sync-written events + 1 from pushStreamEvent = 11 on disk.
      // Memory has 1 (the pushStreamEvent event). Request 12:
      // olderAvailable = 11 - 1 = 10, olderCount = 12 - 1 = 11.
      // Loads min(10, 11) = 10 from disk + 1 in-memory = 11 total.
      const events = await overlay.loadConversationEvents("builder", 12);
      expect(events).toHaveLength(11);
      expect(events[events.length - 1].type).toBe("tool_execution_start");

      overlay.dispose();
    });

    it("returns in-memory events directly when count fits in window", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-merge-events-"));
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "tool_execution_start",
        toolName: "read",
      } as unknown as AgentEvent);

      // count=2 <= memory.length=2, so no disk access — returns in-memory events.
      const events = await overlay.loadConversationEvents("builder", 2);
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("message_start");
      expect(events[1].type).toBe("tool_execution_start");

      overlay.dispose();
    });

    it("loads older events from disk when in-memory window has been capped", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-cap-load-"));
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      // Push MAX_AGENT_EVENTS + 10 events via the overlay.
      // The in-memory buffer will cap at MAX_AGENT_EVENTS, evicting the first 10.
      for (let index = 0; index < MAX_AGENT_EVENTS + 10; index++) {
        overlay.pushStreamEvent("builder", {
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: `event-${index}` }],
          },
        } as unknown as AgentEvent);
      }

      // In-memory has only the last MAX_AGENT_EVENTS events.
      expect(overlay.getConversation("builder")).toHaveLength(MAX_AGENT_EVENTS);

      // Request MAX_AGENT_EVENTS + 5 events — should load 5 older events from
      // disk and merge with the in-memory window.
      const events = await overlay.loadConversationEvents("builder", MAX_AGENT_EVENTS + 5);
      expect(events).toHaveLength(MAX_AGENT_EVENTS + 5);
      // The first event should be event-5 (the 6th pushed, after 5 were evicted).
      const firstContent = (
        events[0] as unknown as { message: { content: Array<{ text: string }> } }
      ).message.content[0].text;
      expect(firstContent).toBe("event-5");
      // The last event should be event-(MAX_AGENT_EVENTS+9).
      const lastContent = (
        events[events.length - 1] as unknown as { message: { content: Array<{ text: string }> } }
      ).message.content[0].text;
      expect(lastContent).toBe(`event-${MAX_AGENT_EVENTS + 9}`);

      overlay.dispose();
    });

    it("handles large files efficiently with small count via streaming", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-stream-big-"));
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      const jsonlPath = join(tmpDir, "builder.events.jsonl");
      const EVENT_COUNT = 5000;
      for (let index = 0; index < EVENT_COUNT; index++) {
        writeFileSync(
          jsonlPath,
          JSON.stringify({
            type: "message_end",
            message: {
              role: "assistant",
              content: [{ type: "text", text: `event-${index}` }],
            },
          }) + "\n",
          { flag: "a" },
        );
      }

      // Register the file path by prepopulating, so loadConversationEvents can find it.
      void overlay.prepopulateStreamFiles(tmpDir);

      const events = await overlay.loadConversationEvents("builder", 50);
      expect(events).toHaveLength(50);

      // Verify the returned events are the most recent 50 (indices 4950–4999).
      const indices = events.map((e) =>
        Number(
          (e as { message: { content: Array<{ text: string }> } }).message.content[0].text.replace(
            "event-",
            "",
          ),
        ),
      );
      expect(Math.min(...indices)).toBe(EVENT_COUNT - 50);
      // Verify ordering: oldest first within the returned window.
      expect(indices).toEqual([...indices].sort((a, b) => a - b));

      overlay.dispose();
      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe("eventsFiles cleanup", () => {
    it("clears eventsFiles map on dispose", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-events-clean-"));
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      // Sync-write the JSONL file so it exists before dispose.
      const jsonlPath = join(tmpDir, "builder.events.jsonl");
      writeFileSync(jsonlPath, JSON.stringify({ type: "message_start" }) + "\n");
      // Trigger eventsFiles path discovery via pushStreamEvent.
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as unknown as AgentEvent);

      // dispose should not throw (covers eventsFiles.clear()).
      expect(() => overlay.dispose()).not.toThrow();

      // File should still exist on disk (shared dir, cleaned on session exit).
      expect(existsSync(jsonlPath)).toBe(true);
    });
  });

  describe("messages.jsonl persistence", () => {
    it("writes finalized assistant message to .messages.jsonl on message_end", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-msgs-write-"));
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      const assistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "Done." }],
      };
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: assistantMessage,
      } as unknown as AgentEvent);

      const messagesPath = join(tmpDir, "builder.messages.jsonl");
      expect(existsSync(messagesPath)).toBe(true);

      const content = readFileSync(messagesPath, "utf-8").trimEnd().split("\n");
      expect(content).toHaveLength(1);
      const parsed = jsonParse<Record<string, unknown>>(content[0]);
      expect(parsed["role"]).toBe("assistant");

      overlay.dispose();
    });

    it("writes user messages to .messages.jsonl on message_end", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-msgs-user-"));
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      const userMessage = {
        role: "user",
        content: [{ type: "text", text: "Do the thing" }],
        timestamp: Date.now(),
      };
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: userMessage,
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: userMessage,
      } as unknown as AgentEvent);

      const content = readFileSync(join(tmpDir, "builder.messages.jsonl"), "utf-8")
        .trimEnd()
        .split("\n");
      expect(content).toHaveLength(1);
      expect(jsonParse<Record<string, unknown>>(content[0])["role"]).toBe("user");

      overlay.dispose();
    });

    it("writes toolResult messages to .messages.jsonl on message_end", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-msgs-toolresult-"));
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      const toolResultMessage = {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "read",
        content: [{ type: "text", text: "file contents" }],
        isError: false,
        timestamp: Date.now(),
      };
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: toolResultMessage,
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: toolResultMessage,
      } as unknown as AgentEvent);

      const content = readFileSync(join(tmpDir, "builder.messages.jsonl"), "utf-8")
        .trimEnd()
        .split("\n");
      expect(content).toHaveLength(1);
      expect(jsonParse<Record<string, unknown>>(content[0])["role"]).toBe("toolResult");

      overlay.dispose();
    });

    it("does not write message_start to .messages.jsonl", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-msgs-start-"));
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant" },
      } as unknown as AgentEvent);

      expect(existsSync(join(tmpDir, "builder.messages.jsonl"))).toBe(false);

      overlay.dispose();
    });

    it("does not write message_update to .messages.jsonl", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-msgs-update-"));
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      overlay.pushStreamEvent("builder", {
        type: "message_update",
        message: { role: "assistant", content: [{ type: "text", text: "partial" }] },
      } as unknown as AgentEvent);

      expect(existsSync(join(tmpDir, "builder.messages.jsonl"))).toBe(false);

      overlay.dispose();
    });

    it("writes one finalized message per message_end (no duplicates for streaming)", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-msgs-stream-"));
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: { role: "assistant", content: [] },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_update",
        message: { role: "assistant", content: [{ type: "text", text: "thinking..." }] },
      } as unknown as AgentEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "final answer" }] },
      } as unknown as AgentEvent);

      const content = readFileSync(join(tmpDir, "builder.messages.jsonl"), "utf-8")
        .trimEnd()
        .split("\n");
      expect(content).toHaveLength(1);
      const parsed = jsonParse<{ content: Array<{ text: string }> }>(content[0]);
      expect(parsed.content[0]?.text).toBe("final answer");

      overlay.dispose();
    });
  });

  describe("messages.jsonl prepopulate", () => {
    it("loads finalized messages from .messages.jsonl into the message cache", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-prepop-msgs-"));
      const messagesPath = join(tmpDir, "builder.messages.jsonl");
      const userMessage = {
        role: "user",
        content: [{ type: "text", text: "hello" }],
        timestamp: 0,
      };
      const assistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "hi there" }],
      };
      writeFileSync(
        messagesPath,
        [JSON.stringify(userMessage), JSON.stringify(assistantMessage)].join("\n") + "\n",
      );

      const overlay = makeOverlay();
      await overlay.prepopulateStreamFiles(tmpDir);

      const messages = overlay.getConversationMessages("builder");
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({ role: "user" });
      expect(messages[1]).toMatchObject({ role: "assistant" });

      overlay.dispose();
    });

    it("creates a stale done entry for an agent known only from messages.jsonl", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-prepop-msgs-entry-"));
      writeFileSync(
        join(tmpDir, "builder.messages.jsonl"),
        JSON.stringify({ role: "assistant", content: [{ type: "text", text: "done" }] }) + "\n",
      );

      const overlay = makeOverlay();
      void overlay.prepopulateStreamFiles(tmpDir);

      const lines = overlay.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("builder");
      expect(joined).toContain("Agent completed");

      overlay.dispose();
    });

    it("does not load raw events from .events.jsonl into the event buffer at startup", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-prepop-no-events-"));
      const eventsPath = join(tmpDir, "builder.events.jsonl");
      writeFileSync(
        eventsPath,
        [JSON.stringify({ type: "message_start", message: { role: "assistant" } })].join("\n") +
          "\n",
      );

      const overlay = makeOverlay();
      void overlay.prepopulateStreamFiles(tmpDir);

      // Raw events are NOT loaded at startup — diagnostics only.
      expect(overlay.getConversation("builder")).toEqual([]);

      overlay.dispose();
    });

    it("caps loaded messages at MAX_AGENT_EVENTS keeping the most recent", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-prepop-cap-"));
      const messagesPath = join(tmpDir, "builder.messages.jsonl");
      const lines: string[] = [];
      for (let index = 0; index < MAX_AGENT_EVENTS + 50; index++) {
        lines.push(
          JSON.stringify({
            role: "assistant",
            content: [{ type: "text", text: `msg-${index}` }],
          }),
        );
      }
      writeFileSync(messagesPath, lines.join("\n") + "\n");

      const overlay = makeOverlay();
      await overlay.prepopulateStreamFiles(tmpDir);

      const messages = overlay.getConversationMessages("builder");
      expect(messages).toHaveLength(MAX_AGENT_EVENTS);
      // Oldest messages evicted, first kept is msg-50.
      const firstText = (messages[0] as { content: Array<{ text: string }> }).content[0]?.text;
      expect(firstText).toBe(`msg-50`);
      const lastText = (messages[messages.length - 1] as { content: Array<{ text: string }> })
        .content[0]?.text;
      expect(lastText).toBe(`msg-${MAX_AGENT_EVENTS + 49}`);

      overlay.dispose();
    });

    it("skips malformed message lines without throwing", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-prepop-malformed-"));
      writeFileSync(
        join(tmpDir, "builder.messages.jsonl"),
        ["{not json", JSON.stringify({ role: "assistant", content: [] })].join("\n") + "\n",
      );

      const overlay = makeOverlay();
      await overlay.prepopulateStreamFiles(tmpDir);
      // Malformed line skipped, valid line parsed.
      expect(overlay.getConversationMessages("builder")).toHaveLength(1);

      overlay.dispose();
    });

    it("emits a single done entry for an agent with multiple file kinds", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-prepop-dedup-"));
      // Same agent has all three file kinds — done must fire once.
      writeFileSync(join(tmpDir, "builder.stream"), "message_end: done\n", "utf-8");
      writeFileSync(
        join(tmpDir, "builder.messages.jsonl"),
        JSON.stringify({ role: "assistant", content: [{ type: "text", text: "ok" }] }) + "\n",
      );
      writeFileSync(
        join(tmpDir, "builder.events.jsonl"),
        JSON.stringify({ type: "message_start", message: { role: "assistant" } }) + "\n",
      );

      const overlay = makeOverlay();
      void overlay.prepopulateStreamFiles(tmpDir);

      // Synchronous update() dedupes via has()===true — entryCount stays 1.
      // Note: prepopulation does not invoke the onDone UI escape callback;
      // makeOverlay() provides a default vi.fn() that simply stays unused.
      expect(overlay.entryCount).toBe(1);

      overlay.dispose();
    });

    it("prepopulates both files: messages loaded, raw events skipped, streaming works", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-prepop-both-"));

      // Create .messages.jsonl with finalized messages
      writeFileSync(
        join(tmpDir, "builder.messages.jsonl"),
        [
          JSON.stringify({
            role: "user",
            content: [{ type: "text", text: "question" }],
            timestamp: 0,
          }),
          JSON.stringify({
            role: "assistant",
            content: [{ type: "text", text: "answer" }],
            timestamp: 1,
          }),
        ].join("\n") + "\n",
      );

      // Create large .events.jsonl with raw events (should NOT be eager-loaded)
      const LARGE_COUNT = 5_000;
      const eventLines: string[] = [];
      for (let i = 0; i < LARGE_COUNT; i++) {
        eventLines.push(
          JSON.stringify({
            type: "message_start",
            message: { role: "assistant", content: [{ type: "text", text: `event-${i}` }] },
          }),
        );
      }
      writeFileSync(join(tmpDir, "builder.events.jsonl"), eventLines.join("\n") + "\n");

      const overlay = makeOverlay();
      await overlay.prepopulateStreamFiles(tmpDir);

      // Messages from .messages.jsonl are loaded into the cache
      const cached = overlay.getConversationMessages("builder");
      expect(cached).toHaveLength(2);
      expect(cached[0]).toMatchObject({ role: "user" });
      expect(cached[1]).toMatchObject({ role: "assistant" });

      // Raw events from .events.jsonl are NOT eager-loaded
      expect(overlay.getConversation("builder")).toEqual([]);

      // Streaming loadConversationEvents returns subset from large file
      const streamed = await overlay.loadConversationEvents("builder", 50);
      expect(streamed).toHaveLength(50);
      const indices = streamed.map((e) =>
        Number(
          (e as { message: { content: Array<{ text: string }> } }).message.content[0].text.replace(
            "event-",
            "",
          ),
        ),
      );
      indices.forEach((i) => expect(i).toBeGreaterThanOrEqual(LARGE_COUNT - 50));

      overlay.dispose();
      rmSync(tmpDir, { recursive: true, force: true });
    });
  });

  describe("messagesFiles cleanup", () => {
    it("clears messagesFiles map on dispose", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-msgs-clean-"));
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      // Finalized message write registers the messagesFiles path.
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
      } as unknown as AgentEvent);

      expect(existsSync(join(tmpDir, "builder.messages.jsonl"))).toBe(true);
      expect(() => overlay.dispose()).not.toThrow();
      expect(existsSync(join(tmpDir, "builder.messages.jsonl"))).toBe(true);
    });
  });
});
