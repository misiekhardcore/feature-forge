import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import type { MarkdownTheme, TUI } from "@earendil-works/pi-tui";
import { AgentStatus } from "@feature-forge/core";
import type { Agent, AgentKind } from "@feature-forge/core/agents";
import type { AgentSpecification } from "@feature-forge/core/agents";
import { AgentSupervisor } from "@feature-forge/core/agents";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { makeMockToolRegistry, makeMockTypedEventBus } from "../../test-utils";
import { AgentDisplayHelpers } from "../display";
import { MAX_AGENT_EVENTS } from "../state/AgentViewerState";
import {
  agentEndEvent,
  agentStartEvent,
  assistantMessage,
  messageEndEvent,
  messageStartEvent,
  messageUpdateEvent,
  text,
  toolCall,
  toolEndEvent,
  toolStartEvent,
  toolUpdateEvent,
  turnEndEvent,
  turnStartEvent,
  userMessage,
} from "../test-utils";
import type { AgentViewerEntry } from "../types";
import { AgentViewerOverlay, type AgentViewerOverlayParams } from "./AgentViewerOverlay";

const mockConfig = {
  getDisplayMaxAgentEvents: () => MAX_AGENT_EVENTS,
  getDisplayMaxPreconnectBuffer: () => 100,
  getDisplayMaxOverlayHeight: () => "85%",
  getHideThinkingBlock: () => false,
};

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
  if (status === "running") {
    return { id, status: "running", createdAt: new Date(), ...overrides };
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
  if (status === "cancelled") {
    return { id, status: "cancelled", createdAt: new Date(), ...overrides };
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
    config: mockConfig,
    ...overrides,
  });
}

/** Parse the journal file of an agent into entries ([] when absent). */
function readJournal(dir: string, agentId: string): Array<Record<string, unknown>> {
  const journalPath = join(dir, `${agentId}.journal.jsonl`);
  if (!existsSync(journalPath)) return [];
  return readFileSync(journalPath, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
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
        config: mockConfig,
      });

      expect(overlay.entryCount).toBe(0);

      // Verify the overlay functions correctly with custom params.
      overlay.update({ id: "builder", status: "started", createdAt: new Date() });
      expect(overlay.entryCount).toBe(1);

      // Verify event processing and rendering work with non-default theme values.
      overlay.pushStreamEvent("builder", toolStartEvent("read"));
      const lines = overlay.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("builder");
      expect(joined).toContain("read");
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
      overlay.pushStreamEvent("builder", toolStartEvent("read"));

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("read");
      expect(joined).toContain("⟳");
    });

    it("shows last stream line as description for done agents", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "done", { passed: true, summary: "Build passed" }));
      overlay.pushStreamEvent("builder", toolStartEvent("read"));

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      // SelectList shows last stream line as description; summary is not separately rendered.
      expect(joined).toContain("read");
    });

    it("does not truncate short last stream lines", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      const shortLine = "read";
      overlay.pushStreamEvent("builder", toolStartEvent("read"));

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
      overlay.pushStreamEvent("builder", toolStartEvent("read"));

      overlay.clearMemory();

      expect(overlay.entryCount).toBe(0);
      // lastLines are NOT cleared by clearMemory — they persist.
      expect(overlay.getLastStreamLine("builder")).toBe("read");
      expect(overlay.lastStreamLine).toBe("read");
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

    it("maps Running to running", () => {
      expect(AgentViewerOverlay.mapStatus(AgentStatus.Running)).toBe("running");
    });

    it("maps Completed to done", () => {
      expect(AgentViewerOverlay.mapStatus(AgentStatus.Completed)).toBe("done");
    });

    it("maps Failed to error", () => {
      expect(AgentViewerOverlay.mapStatus(AgentStatus.Failed)).toBe("error");
    });

    it("maps Cancelled to cancelled", () => {
      expect(AgentViewerOverlay.mapStatus(AgentStatus.Cancelled)).toBe("cancelled");
    });
  });

  describe("getOverlayOptions", () => {
    function makeHeightConfig(height: string) {
      return { ...mockConfig, getDisplayMaxOverlayHeight: () => height };
    }

    it("returns the default options without a config", () => {
      expect(AgentViewerOverlay.getOverlayOptions()).toEqual({
        anchor: "center",
        width: "100%",
        maxHeight: "85%",
        margin: 1,
      });
    });

    it("returns a fresh copy on every call", () => {
      const first = AgentViewerOverlay.getOverlayOptions();
      const second = AgentViewerOverlay.getOverlayOptions();
      expect(first).not.toBe(second);
    });

    it("keeps the default height when the config returns '85%'", () => {
      const options = AgentViewerOverlay.getOverlayOptions(makeHeightConfig("85%"));
      expect(options.maxHeight).toBe("85%");
    });

    it("forwards a percentage height from the config", () => {
      const options = AgentViewerOverlay.getOverlayOptions(makeHeightConfig("40%"));
      expect(options.maxHeight).toBe("40%");
    });

    it("converts a numeric pixel-count height from the config", () => {
      const options = AgentViewerOverlay.getOverlayOptions(makeHeightConfig("30"));
      expect(options.maxHeight).toBe(30);
    });

    it("falls back to the default height for invalid config values", () => {
      const options = AgentViewerOverlay.getOverlayOptions(makeHeightConfig("not-a-size"));
      expect(options.maxHeight).toBe("85%");
    });
  });

  describe("formatStreamEvent", () => {
    it("formats tool_execution_start events as '<toolName>'", () => {
      const line = AgentViewerOverlay.formatStreamEvent(toolStartEvent("read"));
      expect(line).toBe("read");
    });

    it("includes serialized args in tool_execution_start stream line", () => {
      const line = AgentViewerOverlay.formatStreamEvent(
        toolStartEvent("bash", { command: "ls -la" }),
      );
      expect(line).toContain("bash");
      expect(line).toContain("|");
      expect(line).toContain('"command"');
      expect(line).toContain("ls -la");
    });

    it("includes serialized string args in tool_execution_start stream line", () => {
      const line = AgentViewerOverlay.formatStreamEvent(toolStartEvent("read", "some-file.txt"));
      expect(line).toContain("read");
      expect(line).toContain("|");
      expect(line).toContain("some-file.txt");
    });

    it("formats tool_execution_end with ok status", () => {
      const line = AgentViewerOverlay.formatStreamEvent(toolEndEvent("tool", "some output"));
      expect(line).toBe("tool (ok)");
    });

    it("formats tool_execution_end with error status", () => {
      const line = AgentViewerOverlay.formatStreamEvent(toolEndEvent("tool", "", true));
      expect(line).toBe("tool (error)");
    });

    it("formats message_start with nested message role", () => {
      const line = AgentViewerOverlay.formatStreamEvent(messageStartEvent(assistantMessage()));
      expect(line).toBe("assistant");
    });

    it("formats message_end with content text blocks", () => {
      const line = AgentViewerOverlay.formatStreamEvent(
        messageEndEvent(assistantMessage([text("Here is the result.")])),
      );
      expect(line).toBe("Here is the result.");
    });

    it("formats agent_start as 'started'", () => {
      const line = AgentViewerOverlay.formatStreamEvent(agentStartEvent());
      expect(line).toBe("started");
    });

    it("formats agent_end as 'completed'", () => {
      const line = AgentViewerOverlay.formatStreamEvent(agentEndEvent());
      expect(line).toBe("completed");
    });

    it("formats turn_start and turn_end", () => {
      expect(AgentViewerOverlay.formatStreamEvent(turnStartEvent())).toBe("turn start");
      expect(AgentViewerOverlay.formatStreamEvent(turnEndEvent())).toBe("turn end");
    });

    it("formats tool_execution_update with partial result", () => {
      const line = AgentViewerOverlay.formatStreamEvent(toolUpdateEvent("read", "Reading file..."));
      expect(line).toBe("read: Reading file...");
    });

    it("returns just the type for events with no known detail", () => {
      // Intentionally out-of-schema event — exercises the formatDetail fallback.
      const line = AgentViewerOverlay.formatStreamEvent({
        type: "unknown_type",
      } as unknown as JsonAgentSessionEvent);
      expect(line).toBe("unknown_type");
    });

    it("formats tool_execution_update with object partialResult", () => {
      const line = AgentViewerOverlay.formatStreamEvent(toolUpdateEvent("read", { key: "value" }));
      expect(line).toContain("read:");
      expect(line).toContain("key");
    });
  });

  describe("pushStreamEvent", () => {
    it("stores the formatted stream line in memory for a given agent", () => {
      const overlay = makeOverlay();
      overlay.pushStreamEvent("builder", toolStartEvent("read"));

      expect(overlay.getLastStreamLine("builder")).toBe("read");
    });

    it("overwrites previous last line for the same agent", () => {
      const overlay = makeOverlay();
      overlay.pushStreamEvent("builder", toolStartEvent("read"));
      overlay.pushStreamEvent("builder", toolStartEvent("write"));

      expect(overlay.getLastStreamLine("builder")).toBe("write");
    });

    it("tracks last lines per agent independently", () => {
      const overlay = makeOverlay();
      overlay.pushStreamEvent("builder", toolStartEvent("read"));
      overlay.pushStreamEvent("reviewer", toolStartEvent("lint"));

      expect(overlay.getLastStreamLine("builder")).toBe("read");
      expect(overlay.getLastStreamLine("reviewer")).toBe("lint");
    });

    it("does not throw when a streamDir is configured (display-only, never writes)", () => {
      // The overlay is display-only: a configured streamDir serves replay
      // reads, so even an unusable path must not throw during live pushes.
      const overlay = makeOverlay();
      overlay.setStreamDir("/nonexistent/path/that/should/fail");

      expect(() => {
        overlay.pushStreamEvent("builder", toolStartEvent("read"));
      }).not.toThrow();

      expect(overlay.getLastStreamLine("builder")).toBe("read");

      overlay.dispose();
    });

    it("pushes event for an agent not yet added via update", () => {
      const overlay = makeOverlay();

      overlay.pushStreamEvent("unknown-agent", toolStartEvent("read"));

      expect(overlay.getLastStreamLine("unknown-agent")).toBe("read");
      expect(overlay.lastStreamLine).toBe("read");
    });

    it("requests render when pushing an event", () => {
      const tui = makeTui();
      const overlay = makeOverlay({ tui });

      overlay.pushStreamEvent("builder", toolStartEvent("read"));

      expect(tui.requestRender).toHaveBeenCalled();
    });
  });

  describe("lastStreamLine", () => {
    it("returns empty string when no stream events have been pushed", () => {
      const overlay = makeOverlay();
      expect(overlay.lastStreamLine).toBe("");
    });

    it("returns the most recently recorded line across all agents", () => {
      const overlay = makeOverlay();
      overlay.pushStreamEvent("builder", toolStartEvent("read"));
      overlay.pushStreamEvent("reviewer", toolStartEvent("lint"));

      expect(overlay.lastStreamLine).toBe("lint");
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

    it("leaves recorder-written journal files on disk after dispose", () => {
      // Journals are written by the AgentJournalRecorder (the disk writer);
      // the display overlay's dispose must never delete them.
      writeFileSync(
        join(tmpDir, "builder.journal.jsonl"),
        JSON.stringify({ type: "lifecycle", phase: "started", ts: "2026-01-01T00:00:00.000Z" }) +
          "\n",
        "utf-8",
      );

      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);
      overlay.update(makeEntry("builder", "started"));
      overlay.dispose();

      expect(existsSync(join(tmpDir, "builder.journal.jsonl"))).toBe(true);
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
      overlay.pushStreamEvent("builder", toolStartEvent("read"));

      overlay.dispose();
      expect(() => overlay.dispose()).not.toThrow();
    });

    it("does not throw when streamDir was never configured", () => {
      const overlay = makeOverlay();

      expect(() => overlay.dispose()).not.toThrow();
    });

    it("clears last-line state on dispose", () => {
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);
      overlay.pushStreamEvent("builder", toolStartEvent("read"));
      overlay.pushStreamEvent("reviewer", toolStartEvent("lint"));

      expect(overlay.getLastStreamLine("builder")).toBe("read");

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
      overlay.scrollOffsetEnd = 5;

      overlay.handleInput("\x1b");

      expect(overlay.viewMode).toBe("list");
      expect(overlay.selectedAgentId).toBeUndefined();
      expect(overlay.scrollOffsetEnd).toBe(0);
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
      // Auto-scroll enabled and scrollOffsetEnd set to bottom on entering detail view.
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
      overlay.scrollOffsetEnd = 3;

      overlay.handleInput("\x1b[A");

      expect(overlay.scrollOffsetEnd).toBe(4);
      expect(tui.requestRender).toHaveBeenCalled();
    });

    it("scrolls up from bottom", () => {
      const tui = makeTui();
      const overlay = makeOverlay({ tui });
      overlay.update(makeEntry("builder", "done"));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      overlay.scrollOffsetEnd = 0;

      overlay.handleInput("\x1b[A");

      expect(overlay.scrollOffsetEnd).toBe(1);
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
      overlay.scrollOffsetEnd = 5;

      overlay.handleInput("\x1b[B");

      expect(overlay.scrollOffsetEnd).toBe(4);
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
      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
      overlay.pushStreamEvent("builder", toolStartEvent("read"));
      overlay.pushStreamEvent("builder", toolEndEvent("read", "file contents", false));
      overlay.pushStreamEvent(
        "builder",
        messageEndEvent(assistantMessage([text("file contents")])),
      );
      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
      overlay.pushStreamEvent("builder", toolStartEvent("write"));
      overlay.pushStreamEvent("builder", toolEndEvent("write", "written", false));
      overlay.pushStreamEvent("builder", messageEndEvent(assistantMessage([text("written")])));
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
      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
      overlay.pushStreamEvent("builder", messageEndEvent(assistantMessage([text("Done.")])));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Conversation:");
      expect(joined).toContain("Done.");
      expect(joined).not.toContain("Last event:");
    });

    it("derives hide-thinking visibility from DisplayConfig in detail view", () => {
      let hideThinking = false;
      const overlay = makeOverlay({
        config: {
          getDisplayMaxAgentEvents: () => MAX_AGENT_EVENTS,
          getDisplayMaxPreconnectBuffer: () => 100,
          getDisplayMaxOverlayHeight: () => "85%",
          getHideThinkingBlock: () => hideThinking,
        },
      });
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
      overlay.pushStreamEvent(
        "builder",
        messageEndEvent(
          assistantMessage([
            { type: "thinking", thinking: "internal reasoning trace" },
            text("final answer"),
          ]),
        ),
      );
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      // Thinking visible while the config getter returns false.
      const visible = overlay.render(80).join("\n");
      expect(visible).toContain("internal reasoning trace");
      expect(visible).not.toContain("Thinking...");

      // Config flip lands on the next render (no settings-change event).
      hideThinking = true;
      const hidden = overlay.render(80).join("\n");
      expect(hidden).toContain("Thinking...");
      expect(hidden).not.toContain("internal reasoning trace");
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
      // Intentionally malformed messages — exercises the unknown-role fallback.
      overlay.pushStreamEvent("builder", {
        type: "message_start",
        message: {},
      } as unknown as JsonAgentSessionEvent);
      overlay.pushStreamEvent("builder", {
        type: "message_end",
        message: { content: [{ type: "text", text: "No role here." }] },
      } as unknown as JsonAgentSessionEvent);
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
      overlay.pushStreamEvent("builder", toolStartEvent("bash"));
      overlay.pushStreamEvent("builder", toolEndEvent("bash", "done", false));
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
      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
      overlay.pushStreamEvent("builder", messageEndEvent(assistantMessage([text(shortContent)])));
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
      overlay.pushStreamEvent("builder", toolStartEvent("read"));
      overlay.pushStreamEvent("builder", toolEndEvent("read", "short", false));
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
      overlay.scrollOffsetEnd = 5;

      overlay.clearMemory();

      expect(overlay.viewMode).toBe("list");
      expect(overlay.selectedIndex).toBe(0);
      expect(overlay.selectedAgentId).toBeUndefined();
      expect(overlay.scrollOffsetEnd).toBe(0);
    });
  });

  describe("wireOverlayEvents", () => {
    function makeMockAgent(
      id: string,
      role: string,
      status: AgentStatus,
      createdAt: Date = new Date(),
      overrides: { model?: string; thinkingLevel?: ThinkingLevel } = {},
      kind: AgentKind = "subprocess",
    ): Agent {
      return {
        id,
        kind,
        status,
        createdAt,
        specification: { role, ...overrides } as AgentSpecification,
        destroy: vi.fn(),
      };
    }

    function makeMockSupervisor(agents: Agent[] = []): AgentSupervisor {
      return {
        getAgent: vi.fn((agentId: string) => agents.find((a) => a.id === agentId)),
        getAllAgents: vi.fn(() => agents),
        spawnGuest: vi.fn(),
        mountInSession: vi.fn(),
        runAgent: vi.fn(),
        destroyAgent: vi.fn(),
      };
    }

    it("threads model and thinkingLevel from agentQuery into entries during connect", () => {
      const agent = makeMockAgent("builder", "builder", AgentStatus.Running, new Date(), {
        model: "claude-sonnet-4-5",
        thinkingLevel: "high",
      });
      const agentQuery = makeMockSupervisor([agent]);
      const eventBus = makeMockTypedEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        agentQuery,
        config: mockConfig,
        toolRegistry: makeMockToolRegistry(),
      });

      connect(overlay, "");

      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("builder - claude-sonnet-4-5 (high)");

      unsubs.forEach((u) => u());
      overlay.dispose();
    });

    it("threads model and thinkingLevel from agentQuery on agent-done events", () => {
      const agent = makeMockAgent("builder", "builder", AgentStatus.Completed, new Date(), {
        model: "claude-sonnet-4-5",
        thinkingLevel: "high",
      });
      const agentQuery = makeMockSupervisor([agent]);
      const eventBus = makeMockTypedEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        agentQuery,
        config: mockConfig,
        toolRegistry: makeMockToolRegistry(),
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

      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("builder - claude-sonnet-4-5 (high)");

      unsubs.forEach((u) => u());
      overlay.dispose();
    });

    it("omits model and thinkingLevel from detail title when absent", () => {
      const agent = makeMockAgent("builder", "builder", AgentStatus.Running);
      const agentQuery = makeMockSupervisor([agent]);
      const eventBus = makeMockTypedEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        agentQuery,
        config: mockConfig,
        toolRegistry: makeMockToolRegistry(),
      });

      connect(overlay, "");

      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("builder");
      expect(joined).not.toContain("claude");
      expect(joined).not.toContain("(high)");

      unsubs.forEach((u) => u());
      overlay.dispose();
    });

    it("propagates passed: true from agent-done event to the entry", () => {
      const agent = makeMockAgent("builder", "builder", AgentStatus.Completed);
      const agentQuery = makeMockSupervisor([agent]);
      const eventBus = makeMockTypedEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        agentQuery,
        config: mockConfig,
        toolRegistry: makeMockToolRegistry(),
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
      const agentQuery = makeMockSupervisor([agent]);
      const eventBus = makeMockTypedEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        agentQuery,
        config: mockConfig,
        toolRegistry: makeMockToolRegistry(),
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
      const agentQuery = makeMockSupervisor([agent]);
      const eventBus = makeMockTypedEventBus();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        agentQuery,
        config: mockConfig,
        toolRegistry: makeMockToolRegistry(),
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

    it("sets passed on entries when initializing from agentQuery after connect", () => {
      const agent = makeMockAgent("builder", "builder", AgentStatus.Running);
      const agentQuery = makeMockSupervisor([agent]);
      const eventBus = makeMockTypedEventBus();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        agentQuery,
        config: mockConfig,
        toolRegistry: makeMockToolRegistry(),
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

    it("seeds subprocess agents only, excluding in-session personas, on connect", () => {
      const subprocessAgent = makeMockAgent("builder", "builder", AgentStatus.Running);
      const sessionAgent = makeMockAgent(
        "orchestrator",
        "orchestrator",
        AgentStatus.Running,
        new Date(),
        {},
        "in-session",
      );
      const agentQuery = makeMockSupervisor([subprocessAgent, sessionAgent]);
      const eventBus = makeMockTypedEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        agentQuery,
        config: mockConfig,
        toolRegistry: makeMockToolRegistry(),
      });

      connect(overlay, "");

      // Only the subprocess agent is seeded — the in-session persona must
      // never appear in the overlay (or /agent:list) list.
      expect(overlay.entryCount).toBe(1);
      const joined = overlay.render(80).join("\n");
      expect(joined).toContain("builder");
      expect(joined).not.toContain("orchestrator");

      unsubs.forEach((u) => u());
      overlay.dispose();
    });

    it("seeds a Cancelled agent as cancelled, not error, on connect", () => {
      const agent = makeMockAgent("cancelled-agent", "builder", AgentStatus.Cancelled);
      const agentQuery = makeMockSupervisor([agent]);
      const eventBus = makeMockTypedEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        agentQuery,
        config: mockConfig,
        toolRegistry: makeMockToolRegistry(),
      });

      connect(overlay, "");

      overlay.viewMode = "detail";
      overlay.selectedAgentId = "cancelled-agent";

      const lines = overlay.render(80);
      // Pattern-match on ANSI-stripped output: the detail header line must
      // carry the muted "○" icon and the "cancelled" status label — never
      // "error". (A plain substring check for "cancelled" is vacuous because
      // the agent id "cancelled-agent" already contains it.)
      const clean = lines.map(stripAnsiForTest).join("\n");
      expect(clean).toMatch(/○ .*cancelled-agent .*- .*cancelled/);
      expect(clean).not.toMatch(/error/);
      expect(clean).not.toContain("✗");

      unsubs.forEach((u) => u());
      overlay.dispose();
    });

    it("yields status cancelled for agent-done when the query status is Cancelled", () => {
      const agent = makeMockAgent("cancelled-agent", "builder", AgentStatus.Cancelled);
      const agentQuery = makeMockSupervisor([agent]);
      const eventBus = makeMockTypedEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        agentQuery,
        config: mockConfig,
        toolRegistry: makeMockToolRegistry(),
      });

      connect(overlay, "");

      eventBus.emit("feature-forge:agent-done", {
        phase: "agent-done",
        message: 'Agent "cancelled-agent" done',
        details: {
          executionId: "exec-1",
          agentId: "cancelled-agent",
          passed: false,
          summary: "Cancelled by user",
        },
      });

      overlay.viewMode = "detail";
      overlay.selectedAgentId = "cancelled-agent";

      const lines = overlay.render(80);
      // Same header pattern as the connect-seeding test: the done event must
      // resolve to the "cancelled" label (via the query's Cancelled status),
      // not "error".
      const clean = lines.map(stripAnsiForTest).join("\n");
      expect(clean).toMatch(/○ .*cancelled-agent .*- .*cancelled/);
      expect(clean).not.toMatch(/error/);
      expect(clean).not.toContain("✗");

      unsubs.forEach((u) => u());
      overlay.dispose();
    });

    it("ignores events without agentId in details", () => {
      const agentQuery = makeMockSupervisor();
      const eventBus = makeMockTypedEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        agentQuery,
        config: mockConfig,
        toolRegistry: makeMockToolRegistry(),
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
      const agentQuery = makeMockSupervisor([agent]);
      const eventBus = makeMockTypedEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        agentQuery,
        config: mockConfig,
        toolRegistry: makeMockToolRegistry(),
      });

      connect(overlay, "");

      eventBus.emit("feature-forge:agent-stream", {
        phase: "agent-stream",
        message: 'Agent "builder" stream event',
        details: {
          executionId: "exec-1",
          label: "builder",
          agentId: "builder",
          event: toolStartEvent("write"),
        },
      });

      expect(overlay.getLastStreamLine("builder")).toBe("write");

      unsubs.forEach((u) => u());
      overlay.dispose();
    });

    it("returns three unsubs, one per subscribed channel", () => {
      const agentQuery = makeMockSupervisor();
      const eventBus = makeMockTypedEventBus();

      const { unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        agentQuery,
        config: mockConfig,
        toolRegistry: makeMockToolRegistry(),
      });

      expect(unsubs).toHaveLength(3);
      for (const unsub of unsubs) {
        expect(unsub).toBeInstanceOf(Function);
      }
    });

    it("unsubs stop event processing for the unsubscribed channel", () => {
      const agent = makeMockAgent("builder", "builder", AgentStatus.Running);
      const agentQuery = makeMockSupervisor([agent]);
      const eventBus = makeMockTypedEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        agentQuery,
        config: mockConfig,
        toolRegistry: makeMockToolRegistry(),
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
      const agentQuery = makeMockSupervisor([]);
      const eventBus = makeMockTypedEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        agentQuery,
        config: mockConfig,
        toolRegistry: makeMockToolRegistry(),
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
      const agentQuery = makeMockSupervisor([agent]);
      const eventBus = makeMockTypedEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        agentQuery,
        config: mockConfig,
        toolRegistry: makeMockToolRegistry(),
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
      const agentQuery = makeMockSupervisor([]);
      const eventBus = makeMockTypedEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        agentQuery,
        config: mockConfig,
        toolRegistry: makeMockToolRegistry(),
      });

      connect(overlay, "");

      // Emit agent-done without a summary — agentQuery has no agent,
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
      const agentQuery = makeMockSupervisor([agent]);
      const eventBus = makeMockTypedEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        agentQuery,
        config: mockConfig,
        toolRegistry: makeMockToolRegistry(),
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
      const agentQuery = makeMockSupervisor([agent]);
      const eventBus = makeMockTypedEventBus();
      const overlay = makeOverlay();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        agentQuery,
        config: mockConfig,
        toolRegistry: makeMockToolRegistry(),
      });

      connect(overlay, "");

      // Emit agent-stream without an event payload — should be silently
      // ignored (no-op).
      // Malformed stream payload (no event) — the consumer guards against it.
      expect(() => {
        eventBus.emit("feature-forge:agent-stream", {
          phase: "agent-stream",
          message: 'Agent "builder" stream',
          details: {
            executionId: "exec-1",
            agentId: "builder",
            label: "builder",
            event: undefined as unknown as JsonAgentSessionEvent,
          },
        });
      }).not.toThrow();

      // No stream line should be recorded.
      expect(overlay.getLastStreamLine("builder")).toBeUndefined();

      unsubs.forEach((u) => u());
      overlay.dispose();
    });

    it("buffers agent-stream event without event in details (no-op)", () => {
      const agentQuery = makeMockSupervisor([]);
      const eventBus = makeMockTypedEventBus();

      const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
        eventBus,
        agentQuery,
        config: mockConfig,
        toolRegistry: makeMockToolRegistry(),
      });

      // Emit agent-stream without event details BEFORE connect.
      eventBus.emit("feature-forge:agent-stream", {
        phase: "agent-stream",
        message: 'Agent "builder" stream',
        details: {
          executionId: "exec-1",
          agentId: "builder",
          label: "builder",
          // Intentionally empty event — exercises the no-op path.
          event: {} as unknown as JsonAgentSessionEvent,
        },
      });

      const overlay = makeOverlay();
      connect(overlay, "");

      // No stream line should be recorded.
      expect(overlay.getLastStreamLine("builder")).toBeUndefined();

      unsubs.forEach((u) => u());
      overlay.dispose();
    });

    // ── lifecycle journaling ────────────────────────────────

    it("seeding writes no lifecycle entries for agentQuery agents on connect", () => {
      const streamDir = mkdtempSync(join(tmpdir(), "forge-lifecycle-"));
      try {
        const agent = makeMockAgent("builder", "builder", AgentStatus.Running);
        const agentQuery = makeMockSupervisor([agent]);
        const eventBus = makeMockTypedEventBus();
        const overlay = makeOverlay();

        const { connect, unsubs } = AgentViewerOverlay.wireOverlayEvents({
          eventBus,
          agentQuery,
          config: mockConfig,
          toolRegistry: makeMockToolRegistry(),
        });

        connect(overlay, streamDir);

        // The seeded agent is listed, but seeding updates the live entry
        // only — it never journals, so no journal file exists.
        expect(overlay.entryCount).toBe(1);
        expect(existsSync(join(streamDir, "builder.journal.jsonl"))).toBe(false);
        expect(readJournal(streamDir, "builder")).toHaveLength(0);

        unsubs.forEach((u) => u());
        overlay.dispose();
      } finally {
        rmSync(streamDir, { recursive: true, force: true });
      }
    });
  });

  describe("prepopulateStreamFiles", () => {
    it("handles non-stream files in stream directory during prepopulate", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-prepop-"));
      try {
        // Write a non-.stream file alongside a .stream file.
        writeFileSync(join(tmpDir, "notes.txt"), "some notes");
        writeFileSync(join(tmpDir, "builder.stream"), "tool_execution_start: read\n");

        const overlay = makeOverlay();
        await overlay.prepopulateStreamFiles(tmpDir);

        // The migrated .stream file yields an entry for builder; the
        // unrelated notes.txt is ignored.
        const lines = overlay.render(80);
        const joined = lines.join("\n");
        expect(joined).toContain("builder");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("creates entries for agents with legacy stream files on prepopulate (migration)", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-prepop-"));
      try {
        // Write a stream file for an agent that's no longer tracked.
        writeFileSync(
          join(tmpDir, "reviewer.stream"),
          "tool_execution_start: lint\nmessage_end: Done.\n",
        );

        // Also write a stream file for a currently-tracked agent.
        writeFileSync(join(tmpDir, "builder.stream"), "tool_execution_start: read\n");

        const overlay = makeOverlay();
        overlay.update(makeEntry("builder", "started"));
        overlay.setStreamDir(tmpDir);
        await overlay.prepopulateStreamFiles(tmpDir);

        const lines = overlay.render(80);
        const joined = lines.join("\n");

        // Legacy files carry no lifecycle, so replayed entries are
        // truthfully "running" (⟳) — never a fabricated terminal state.
        expect(joined).toContain("⟳");
        expect(joined).toContain("builder");
        expect(joined).toContain("reviewer");
        expect(joined).not.toContain("Agent completed");

        // The legacy file was folded into a journal and removed.
        expect(existsSync(join(tmpDir, "reviewer.stream"))).toBe(false);
        const journal = readFileSync(join(tmpDir, "reviewer.journal.jsonl"), "utf-8");
        expect(journal).toContain("tool_execution_start: lint");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("replay does not overwrite a live-seeded entry (no-overwrite guard)", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-prepop-"));
      try {
        // A journal holding a terminal from a PRIOR run of the same agent id.
        writeFileSync(
          join(tmpDir, "builder.journal.jsonl"),
          JSON.stringify({
            type: "lifecycle",
            phase: "done",
            passed: true,
            summary: "Build passed",
            ts: "2026-01-01T00:05:00.000Z",
          }) + "\n",
          "utf-8",
        );

        const overlay = makeOverlay();
        // connect() seeds the live entry (agentQuery) before prepopulate
        // resolves — it reflects the current session and must win.
        overlay.update(makeEntry("builder", "started"));
        overlay.setStreamDir(tmpDir);
        await overlay.prepopulateStreamFiles(tmpDir);

        // The stale terminal must not relabel the live started entry.
        const lines = overlay.render(80);
        const joined = lines.join("\n");
        expect(joined).not.toContain("✓");
        expect(joined).not.toContain("Build passed");
        expect(joined).toContain("builder");
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

    it("creates entries for agents with stream files in the directory", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-prepop-"));
      try {
        writeFileSync(
          join(tmpDir, "unknown-agent.stream"),
          "tool_execution_start: grep\ntool_execution_end: grep (ok)\n",
        );

        const overlay = makeOverlay();
        await overlay.prepopulateStreamFiles(tmpDir);

        // The entry exists and is truthfully in-flight (legacy files carry
        // no lifecycle).
        expect(overlay.entryCount).toBe(1);
        expect(overlay.render(80).join("\n")).toContain("unknown-agent");

        // The legacy .stream was folded into a journal and removed.
        expect(existsSync(join(tmpDir, "unknown-agent.stream"))).toBe(false);
        const journal = readFileSync(join(tmpDir, "unknown-agent.journal.jsonl"), "utf-8");
        expect(journal).toContain("tool_execution_start: grep");
        expect(journal).toContain("tool_execution_end: grep (ok)");
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("conversation tracking", () => {
    it("records events as raw AgentEvent[] in insertion order", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
      overlay.pushStreamEvent(
        "builder",
        messageEndEvent(assistantMessage([text("I am processing.")])),
      );

      const events = overlay.getConversation("builder");
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("message_start");
      expect(events[1].type).toBe("message_end");
    });

    it("records tool_execution_start and tool_execution_end events", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", toolStartEvent("read"));
      overlay.pushStreamEvent("builder", toolEndEvent("read", "file contents here", false));

      const events = overlay.getConversation("builder");
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("tool_execution_start");
      expect(events[1].type).toBe("tool_execution_end");
    });

    it("captures isError on tool_execution_end", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", toolStartEvent("failed-tool"));
      overlay.pushStreamEvent("builder", toolEndEvent("failed-tool", "something went wrong", true));

      const events = overlay.getConversation("builder");
      expect(events).toHaveLength(2);
      const endEvent = events[1] as Record<string, unknown>;
      expect(endEvent["isError"]).toBe(true);
      expect(endEvent["result"]).toBe("something went wrong");
    });

    it("preserves event order with updates before message_end", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
      overlay.pushStreamEvent("builder", messageUpdateEvent("partial"));
      overlay.pushStreamEvent("builder", messageUpdateEvent("final content"));
      overlay.pushStreamEvent(
        "builder",
        messageEndEvent(assistantMessage([text("final content")])),
      );

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
      overlay.pushStreamEvent("builder", toolStartEvent("read"));
      overlay.pushStreamEvent("builder", toolUpdateEvent("read", "line 1\n"));
      overlay.pushStreamEvent("builder", toolUpdateEvent("read", "line 2\n"));
      overlay.pushStreamEvent("builder", toolEndEvent("read", "line 1\nline 2\n", false));

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
      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
      overlay.pushStreamEvent(
        "builder",
        messageEndEvent(assistantMessage([text("I will read the file.")])),
      );
      overlay.pushStreamEvent("builder", toolStartEvent("read"));
      overlay.pushStreamEvent("builder", toolEndEvent("read", "file contents", false));
      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
      overlay.pushStreamEvent(
        "builder",
        messageEndEvent(assistantMessage([text("The file says hello.")])),
      );

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

      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
      overlay.pushStreamEvent("builder", messageEndEvent(assistantMessage([text("Building...")])));

      overlay.pushStreamEvent("reviewer", messageStartEvent(assistantMessage()));
      overlay.pushStreamEvent(
        "reviewer",
        messageEndEvent(assistantMessage([text("Reviewing...")])),
      );

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
      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
      overlay.pushStreamEvent("builder", messageEndEvent(assistantMessage([text("Hello.")])));

      expect(overlay.getConversation("builder")).toHaveLength(2);
      overlay.dispose();
      expect(overlay.getConversation("builder")).toEqual([]);
    });

    it("handles partial event sequences (message_start without message_end)", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));

      // Raw buffer stores whatever was pushed — message_start is stored.
      const events = overlay.getConversation("builder");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("message_start");
    });

    it("handles orphaned tool_execution_end without prior start", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", toolEndEvent("orphan-tool", "orphan result", false));

      // Raw buffer stores whatever was pushed — tool_execution_end is stored.
      const events = overlay.getConversation("builder");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("tool_execution_end");
    });

    it("isolates events between concurrent agent streams", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.update(makeEntry("reviewer", "started"));

      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
      overlay.pushStreamEvent("builder", messageUpdateEvent("builder partial"));

      overlay.pushStreamEvent("reviewer", messageStartEvent(assistantMessage()));
      overlay.pushStreamEvent(
        "reviewer",
        messageEndEvent(assistantMessage([text("reviewer done")])),
      );

      overlay.pushStreamEvent("builder", messageEndEvent(assistantMessage([text("builder done")])));

      expect(overlay.getConversation("builder")).toHaveLength(3);
      expect(overlay.getConversation("reviewer")).toHaveLength(2);
    });

    it("handles concurrent tool call events correctly", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.update(makeEntry("reviewer", "started"));

      overlay.pushStreamEvent("builder", toolStartEvent("read"));

      overlay.pushStreamEvent("reviewer", toolStartEvent("lint"));
      overlay.pushStreamEvent("reviewer", toolEndEvent("lint", "lint passed", false));

      overlay.pushStreamEvent("builder", toolEndEvent("read", "read failed", true));

      const builderEvents = overlay.getConversation("builder");
      const reviewerEvents = overlay.getConversation("reviewer");

      expect(builderEvents).toHaveLength(2);
      expect(reviewerEvents).toHaveLength(2);
    });

    it("preserves events after clearMemory", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
      overlay.pushStreamEvent("builder", messageEndEvent(assistantMessage([text("Hello.")])));

      overlay.clearMemory();
      expect(overlay.getConversation("builder")).toHaveLength(2);
    });
  });

  describe("conversation rendering in detail view", () => {
    it("renders message turn with role prefix", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
      overlay.pushStreamEvent("builder", messageEndEvent(assistantMessage([text("Processing")])));
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
      overlay.pushStreamEvent("builder", messageStartEvent(userMessage()));
      overlay.pushStreamEvent("builder", messageEndEvent(userMessage([text("Build the project")])));
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
      overlay.pushStreamEvent(
        "builder",
        messageStartEvent(assistantMessage([toolCall("call-1", "read")])),
      );
      overlay.pushStreamEvent("builder", toolStartEvent("read"));
      overlay.pushStreamEvent("builder", toolEndEvent("read", "ok output", false));
      overlay.pushStreamEvent("builder", messageEndEvent(assistantMessage([text("ok output")])));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Conversation:");
    });

    it("renders tool call with error result", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent(
        "builder",
        messageStartEvent(assistantMessage([toolCall("call-1", "failing")])),
      );
      overlay.pushStreamEvent("builder", toolStartEvent("failing"));
      overlay.pushStreamEvent("builder", toolEndEvent("failing", "error message", true));
      overlay.pushStreamEvent(
        "builder",
        messageEndEvent(assistantMessage([text("error message")])),
      );
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
      overlay.pushStreamEvent("builder", toolStartEvent("long-running"));
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
      overlay.pushStreamEvent(
        "builder",
        messageStartEvent(assistantMessage([toolCall("call-1", "read")])),
      );
      overlay.pushStreamEvent("builder", toolStartEvent("read"));
      overlay.pushStreamEvent("builder", toolUpdateEvent("read", "partial content"));
      overlay.pushStreamEvent("builder", toolEndEvent("read", "final content", false));
      overlay.pushStreamEvent(
        "builder",
        messageEndEvent(assistantMessage([text("final content")])),
      );
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Conversation:");
    });

    it("renders mixed conversation with messages and tool calls", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "done"));

      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
      overlay.pushStreamEvent("builder", messageEndEvent(assistantMessage([text("Let me read.")])));

      overlay.pushStreamEvent("builder", toolStartEvent("read"));
      overlay.pushStreamEvent("builder", toolEndEvent("read", "contents", false));

      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
      overlay.pushStreamEvent(
        "builder",
        messageEndEvent(assistantMessage([text("Done reading.")])),
      );

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
      overlay.pushStreamEvent("builder", toolStartEvent("read"));
      overlay.pushStreamEvent("builder", toolEndEvent("read", "line 1\nline 2", false));
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
      overlay.pushStreamEvent("builder", toolStartEvent("read"));
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
      overlay.pushStreamEvent("builder", toolEndEvent("orphan-tool", "orphan result", false));

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
      overlay.pushStreamEvent(
        "builder",
        messageEndEvent(assistantMessage([text("Direct end without start.")])),
      );
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
        overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
        overlay.pushStreamEvent(
          "builder",
          messageEndEvent(assistantMessage([text(`Turn ${i} content`)])),
        );
      }

      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      overlay.scrollOffsetEnd = 0;

      const beforeScroll = overlay.render(80);

      // Scroll up by several lines.
      overlay.scrollOffsetEnd = 3;
      const afterScroll = overlay.render(80);

      // Scrolled render should differ from the non-scrolled one.
      const beforeJoined = beforeScroll.join("\n");
      const afterJoined = afterScroll.join("\n");
      expect(beforeJoined).not.toBe(afterJoined);
    });

    it("scroll offset increases on ArrowUp", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
      overlay.pushStreamEvent("builder", messageEndEvent(assistantMessage([text("Hello.")])));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      overlay.scrollOffsetEnd = 5;

      // Arrow up should increment (scrolls up away from bottom).
      overlay.handleInput("\x1b[A");
      expect(overlay.scrollOffsetEnd).toBe(6);

      // Arrow up again increments further.
      overlay.handleInput("\x1b[A");
      expect(overlay.scrollOffsetEnd).toBe(7);
    });

    it("clamps scroll down to zero as minimum", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));

      // Push conversation turns to create content.
      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
      overlay.pushStreamEvent("builder", messageEndEvent(assistantMessage([text("Short.")])));

      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      // ArrowDown from a positive offset decrements toward bottom.
      overlay.scrollOffsetEnd = 5;
      overlay.handleInput("\x1b[B");

      // Should be decrementing: 5 → 4.
      expect(overlay.scrollOffsetEnd).toBe(4);
    });

    it("scroll offset does not grow unbounded over many scrolls", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));

      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
      overlay.pushStreamEvent("builder", messageEndEvent(assistantMessage([text("Hi")])));

      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      // Simulate many scroll-down operations — should not go below 0.
      for (let i = 0; i < 200; i++) {
        overlay.handleInput("\x1b[B");
      }

      // Should still be within reasonable bounds.
      const lines = overlay.render(80);
      expect(lines.length).toBeGreaterThan(0);
      // offset should not have gone negative for a small conversation.
      expect(overlay.scrollOffsetEnd).toBe(0);
    });

    it("computes max scroll bound from conversation content", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));

      // Push many turns to create scrollable content exceeding viewport height.
      for (let i = 0; i < 20; i++) {
        overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
        overlay.pushStreamEvent(
          "builder",
          messageEndEvent(
            assistantMessage([text(`Turn ${i} line 1\nTurn ${i} line 2\nTurn ${i} line 3`)]),
          ),
        );
      }

      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      // Render at least once to compute scroll bounds.
      overlay.render(80);

      // ArrowDown from a positive offset decrements.
      overlay.scrollOffsetEnd = 5;
      overlay.handleInput("\x1b[B");
      expect(overlay.scrollOffsetEnd).toBe(4);
    });
  });

  describe("conversation content rendering", () => {
    it("renders bold text in message content", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
      overlay.pushStreamEvent(
        "builder",
        messageEndEvent(assistantMessage([text("This is **bold** text.")])),
      );
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("bold");
    });

    it("renders italic text in message content", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
      overlay.pushStreamEvent(
        "builder",
        messageEndEvent(assistantMessage([text("This is *italic* text.")])),
      );
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("italic");
    });

    it("renders inline code in message content", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
      overlay.pushStreamEvent(
        "builder",
        messageEndEvent(assistantMessage([text("Use `npm test` to verify.")])),
      );
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
      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
      overlay.pushStreamEvent(
        "builder",
        messageEndEvent(assistantMessage([text("\n\nHello\n\n")])),
      );
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
      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
      overlay.pushStreamEvent("builder", messageEndEvent(assistantMessage([text("Hello")])));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      overlay.autoScroll = false;
      // Set scrollOffsetEnd to 1 — one step above bottom.
      overlay.scrollOffsetEnd = 1;

      overlay.handleInput("\x1b[B");
      // Render re-enables autoScroll when scrollOffsetEnd reaches 0 (bottom).
      overlay.render(80);

      expect(overlay.autoScroll).toBe(true);
    });

    it("does not resume auto-scroll on ArrowDown when not at bottom", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      // Push enough events to exceed viewport height (fallback=20).
      for (let i = 0; i < 25; i++) {
        overlay.pushStreamEvent("builder", messageStartEvent(userMessage([text(`line ${i}`)])));
        overlay.pushStreamEvent("builder", messageEndEvent(userMessage([text(`line ${i}`)])));
      }
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      overlay.autoScroll = false;
      overlay.scrollOffsetEnd = 5;

      overlay.handleInput("\x1b[B");

      expect(overlay.autoScroll).toBe(false);
    });

    it("auto-scrolls to bottom when new stream event arrives in detail view", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      // Push enough events to exceed viewport height (fallback=20).
      for (let i = 0; i < 25; i++) {
        overlay.pushStreamEvent("builder", messageStartEvent(userMessage([text(`line ${i}`)])));
        overlay.pushStreamEvent("builder", messageEndEvent(userMessage([text(`line ${i}`)])));
      }
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      overlay.autoScroll = true;

      overlay.pushStreamEvent("builder", toolStartEvent("read"));

      // Should have scrolled to bottom (scrollOffsetEnd === 0).
      expect(overlay.scrollOffsetEnd).toBe(0);
    });

    it("does not auto-scroll when autoScroll is off", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";
      overlay.autoScroll = false;
      overlay.scrollOffsetEnd = 5;

      overlay.pushStreamEvent("builder", toolStartEvent("read"));

      // Scroll offset should remain unchanged.
      expect(overlay.scrollOffsetEnd).toBe(5);
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
      overlay.pushStreamEvent(
        "builder",
        messageStartEvent(assistantMessage([toolCall("call-1", "bash", { command: "ls" })])),
      );
      overlay.pushStreamEvent("builder", toolStartEvent("bash", { command: "ls" }));
      overlay.pushStreamEvent("builder", toolEndEvent("bash", "file1\nfile2", false));
      overlay.pushStreamEvent("builder", messageEndEvent(assistantMessage([text("file1\nfile2")])));
      overlay.viewMode = "detail";
      overlay.selectedAgentId = "builder";

      const lines = overlay.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("Conversation:");
    });

    it("renders toolArgs result with tool content in detail view", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent(
        "builder",
        messageStartEvent(assistantMessage([toolCall("call-1", "bash", { command: "cat" })])),
      );
      overlay.pushStreamEvent("builder", toolStartEvent("bash", { command: "cat" }));
      overlay.pushStreamEvent("builder", toolEndEvent("bash", "file.txt", false));
      overlay.pushStreamEvent("builder", messageEndEvent(assistantMessage([text("file.txt")])));
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
      overlay.pushStreamEvent("builder", toolStartEvent("bash", { command: "sleep 10" }));
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

    it("does not replay stream content into event buffer for stale entries", async () => {
      writeFileSync(
        join(tmpDir, "reviewer.stream"),
        ["message_start: assistant", "message_end: Review done."].join("\n"),
        "utf-8",
      );

      const overlay = makeOverlay();
      await overlay.prepopulateStreamFiles(tmpDir);

      // Events are NOT replayed from disk — replay rebuilds the derived
      // caches (lines/messages/tools), never the raw event buffer.
      expect(overlay.getConversation("reviewer")).toEqual([]);
    });

    it("does not replay stream content into event buffer for tracked agents", async () => {
      writeFileSync(
        join(tmpDir, "builder.stream"),
        ["tool_execution_start: read", "tool_execution_end: read (ok)"].join("\n"),
        "utf-8",
      );

      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      await overlay.prepopulateStreamFiles(tmpDir);

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
        overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
      }

      const events = overlay.getConversation("builder");
      expect(events).toHaveLength(MAX_AGENT_EVENTS);
    });

    it("evicts oldest events first (FIFO)", () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));

      // Push MAX_AGENT_EVENTS events with distinct content.
      for (let index = 0; index < MAX_AGENT_EVENTS; index++) {
        overlay.pushStreamEvent(
          "builder",
          messageEndEvent(assistantMessage([text(`event-${index}`)])),
        );
      }

      // Push one more; event-0 should be evicted.
      overlay.pushStreamEvent(
        "builder",
        messageEndEvent(assistantMessage([text("event-overflow")])),
      );

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
        overlay.pushStreamEvent("agent-a", messageStartEvent(assistantMessage()));
      }

      // Push only 5 to agent-b.
      for (let index = 0; index < 5; index++) {
        overlay.pushStreamEvent("agent-b", messageStartEvent(assistantMessage()));
      }

      expect(overlay.getConversation("agent-a")).toHaveLength(MAX_AGENT_EVENTS);
      expect(overlay.getConversation("agent-b")).toHaveLength(5);
    });
  });

  describe("loadConversationEvents", () => {
    it("returns in-memory events when streamDir is configured", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-load-events-"));
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));

      const events = await overlay.loadConversationEvents("builder");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("message_start");

      overlay.dispose();
    });

    it("returns in-memory events when no JSONL file exists", async () => {
      const overlay = makeOverlay();
      overlay.update(makeEntry("builder", "started"));
      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));

      const events = await overlay.loadConversationEvents("builder");
      expect(events).toHaveLength(1);
    });

    it("returns empty array for unknown agent with no JSONL", async () => {
      const overlay = makeOverlay();
      const events = await overlay.loadConversationEvents("unknown");
      expect(events).toHaveLength(0);
    });

    it("serves only the in-memory window even when count exceeds it", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-load-count-"));
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      // Sync-write 10 legacy events — they must NOT feed the window.
      const jsonlPath = join(tmpDir, "builder.events.jsonl");
      for (let index = 0; index < 10; index++) {
        writeFileSync(
          jsonlPath,
          JSON.stringify({ type: "message_start", message: { role: "assistant" } }) + "\n",
          { flag: "a" },
        );
      }
      overlay.pushStreamEvent("builder", toolStartEvent("read"));
      await overlay.prepopulateStreamFiles(tmpDir);

      // count (12) exceeds the in-memory window (1), yet only the window is
      // served — raw events are no longer persisted or re-loaded from disk.
      const events = await overlay.loadConversationEvents("builder", 12);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("tool_execution_start");

      overlay.dispose();
    });

    it("returns in-memory events directly when count fits in window", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-merge-events-"));
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      overlay.pushStreamEvent("builder", messageStartEvent(assistantMessage()));
      overlay.pushStreamEvent("builder", toolStartEvent("read"));

      // count=2 <= memory.length=2, so no disk access — returns in-memory events.
      const events = await overlay.loadConversationEvents("builder", 2);
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("message_start");
      expect(events[1].type).toBe("tool_execution_start");

      overlay.dispose();
    });

    it("serves only the capped in-memory window (no disk fallback)", async () => {
      const overlay = makeOverlay();

      // Push MAX_AGENT_EVENTS + 10 events; the in-memory buffer caps at
      // MAX_AGENT_EVENTS, evicting the first 10.
      for (let index = 0; index < MAX_AGENT_EVENTS + 10; index++) {
        overlay.pushStreamEvent(
          "builder",
          messageEndEvent(assistantMessage([text(`event-${index}`)])),
        );
      }

      expect(overlay.getConversation("builder")).toHaveLength(MAX_AGENT_EVENTS);

      // Requesting more than the window returns exactly the window — the
      // evicted (older) events are gone from memory and never reloaded.
      const events = await overlay.loadConversationEvents("builder", MAX_AGENT_EVENTS + 5);
      expect(events).toHaveLength(MAX_AGENT_EVENTS);
      const firstContent = (
        events[0] as unknown as { message: { content: Array<{ text: string }> } }
      ).message.content[0].text;
      expect(firstContent).toBe(`event-10`);
      const lastContent = (
        events[events.length - 1] as unknown as { message: { content: Array<{ text: string }> } }
      ).message.content[0].text;
      expect(lastContent).toBe(`event-${MAX_AGENT_EVENTS + 9}`);
    });

    it("keeps only the most recent events in the window under volume", async () => {
      const overlay = makeOverlay();
      const EVENT_COUNT = 5000;
      for (let index = 0; index < EVENT_COUNT; index++) {
        overlay.pushStreamEvent(
          "builder",
          messageEndEvent(assistantMessage([text(`event-${index}`)])),
        );
      }

      // The in-memory window caps at MAX_AGENT_EVENTS regardless of volume.
      expect(overlay.getConversation("builder")).toHaveLength(MAX_AGENT_EVENTS);

      const events = await overlay.loadConversationEvents("builder", 50);
      expect(events).toHaveLength(50);

      // Verify the returned events are the most recent 50 (indices
      // EVENT_COUNT-50 … EVENT_COUNT-1).
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
    });
  });

  describe("legacy events file handling", () => {
    it("migrates a legacy .events.jsonl on prepopulate and survives dispose", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-events-clean-"));
      const overlay = makeOverlay();
      overlay.setStreamDir(tmpDir);

      const jsonlPath = join(tmpDir, "builder.events.jsonl");
      writeFileSync(jsonlPath, JSON.stringify({ type: "message_start" }) + "\n");

      await overlay.prepopulateStreamFiles(tmpDir);

      // The legacy events file is folded into the journal (nothing to
      // derive from a bare message_start, so no journal lines are written)
      // and removed; dispose clears in-memory state without touching files.
      expect(existsSync(jsonlPath)).toBe(false);
      expect(() => overlay.dispose()).not.toThrow();
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

    it("creates an entry for an agent known only from messages.jsonl (migration)", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-prepop-msgs-entry-"));
      writeFileSync(
        join(tmpDir, "builder.messages.jsonl"),
        JSON.stringify({ role: "assistant", content: [{ type: "text", text: "done" }] }) + "\n",
      );

      const overlay = makeOverlay();
      await overlay.prepopulateStreamFiles(tmpDir);

      // Migrated legacy files carry no lifecycle, so the entry is truthfully
      // in-flight — never a fabricated "Agent completed".
      const lines = overlay.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("builder");
      expect(joined).toContain("⟳");
      expect(joined).not.toContain("Agent completed");

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

    it("emits a single entry for an agent with multiple legacy file kinds", async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "forge-prepop-dedup-"));
      // Same agent has all three legacy file kinds — one migration into one
      // journal, one replayed entry.
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
      await overlay.prepopulateStreamFiles(tmpDir);

      expect(overlay.entryCount).toBe(1);

      overlay.dispose();
    });

    it("prepopulates legacy files: messages loaded, raw events skipped", async () => {
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

      // Create large .events.jsonl with raw events (never eager-loaded).
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

      // Messages from .messages.jsonl are loaded into the cache (via the
      // migrated journal).
      const cached = overlay.getConversationMessages("builder");
      expect(cached).toHaveLength(2);
      expect(cached[0]).toMatchObject({ role: "user" });
      expect(cached[1]).toMatchObject({ role: "assistant" });

      // Raw events from .events.jsonl are never eager-loaded and never
      // served by loadConversationEvents (the in-memory window is empty).
      expect(overlay.getConversation("builder")).toEqual([]);
      expect(await overlay.loadConversationEvents("builder", 50)).toEqual([]);

      overlay.dispose();
      rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});
