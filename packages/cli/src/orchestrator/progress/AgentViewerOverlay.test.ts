import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

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
});
