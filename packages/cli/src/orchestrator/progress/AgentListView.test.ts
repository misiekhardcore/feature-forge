import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentListView } from "./AgentListView";
import { AgentViewerState } from "./AgentViewerState";

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

describe("AgentListView", () => {
  let state: AgentViewerState;
  let theme: Theme;
  let tui: TUI;
  let onSelectAgent: ReturnType<typeof vi.fn>;
  let onDone: ReturnType<typeof vi.fn>;
  let view: AgentListView;

  beforeEach(() => {
    state = new AgentViewerState();
    theme = makeTheme();
    tui = makeTui();
    onSelectAgent = vi.fn();
    onDone = vi.fn();
    view = new AgentListView(
      state,
      theme,
      tui,
      onSelectAgent as (agentId: string) => void,
      onDone as () => void,
    );
  });

  describe("render", () => {
    it("renders empty state when no agents", () => {
      const lines = view.render(80);
      const joined = lines.join("\n");
      expect(joined).toContain("no agents running");
    });

    it("renders agent entries with status", () => {
      state.update({ id: "builder", status: "started", createdAt: new Date(), role: "builder" });
      state.update({
        id: "reviewer",
        status: "done",
        createdAt: new Date(),
        role: "reviewer",
        passed: true,
        summary: "All good",
      });

      const lines = view.render(100);
      const joined = lines.join("\n");

      expect(joined).toContain("builder");
      expect(joined).toContain("reviewer");
      expect(joined).toContain("All good");
    });

    it("highlights selected agent with cursor", () => {
      state.update({ id: "builder", status: "started", createdAt: new Date() });
      state.update({ id: "reviewer", status: "started", createdAt: new Date() });

      view.selectedIndex = 0;
      const lines0 = view.render(100);
      const joined0 = lines0.join("\n");
      expect(joined0).toContain("→");

      view.selectedIndex = 1;
      const lines1 = view.render(100);
      const joined1 = lines1.join("\n");
      expect(joined1).toContain("→");
    });
  });

  describe("handleInput", () => {
    it("calls onDone on Escape", () => {
      view.handleInput("\x1b");
      expect(onDone).toHaveBeenCalled();
    });

    it("wraps selectedIndex up", () => {
      state.update({ id: "a", status: "started", createdAt: new Date() });
      state.update({ id: "b", status: "started", createdAt: new Date() });

      view.selectedIndex = 0;
      view.handleInput("\x1b[A");
      expect(view.selectedIndex).toBe(1); // wraps to last

      view.handleInput("\x1b[A");
      expect(view.selectedIndex).toBe(0);
    });

    it("wraps selectedIndex down", () => {
      state.update({ id: "a", status: "started", createdAt: new Date() });
      state.update({ id: "b", status: "started", createdAt: new Date() });

      view.selectedIndex = 1;
      view.handleInput("\x1b[B");
      expect(view.selectedIndex).toBe(0); // wraps to first

      view.handleInput("\x1b[B");
      expect(view.selectedIndex).toBe(1);
    });

    it("calls onSelectAgent on Enter", () => {
      state.update({ id: "builder", status: "started", createdAt: new Date() });
      view.selectedIndex = 0;

      view.handleInput("\r");
      expect(onSelectAgent).toHaveBeenCalledWith("builder");
    });

    it("does nothing for Enter when no agents", () => {
      view.handleInput("\r");
      expect(onSelectAgent).not.toHaveBeenCalled();
    });

    it("does nothing for up/down when no agents", () => {
      view.selectedIndex = 0;
      view.handleInput("\x1b[A");
      expect(view.selectedIndex).toBe(0);
      view.handleInput("\x1b[B");
      expect(view.selectedIndex).toBe(0);
    });
  });

  describe("render with lastStreamLine", () => {
    it("shows last stream line for started agents", () => {
      state.pushStreamEvent("builder", { type: "agent_start" }, () => "Processing...");

      const lines = view.render(100);
      const joined = lines.join("\n");
      expect(joined).toContain("Processing...");
    });
  });
});
