import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { AgentViewerState } from "@feature-forge/tui";
import { AgentListView } from "@feature-forge/tui";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

    it("renders agent entries inside bordered container", () => {
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
      expect(joined).toContain("Agent Viewer");
    });

    it("creates items with correct label format", () => {
      state.update({
        id: "builder",
        status: "started",
        createdAt: new Date(),
        role: "builder",
      });

      const lines = view.render(100);
      const joined = lines.join("\n");

      // Label format: icon id (role) elapsed
      expect(joined).toContain("builder");
      expect(joined).toContain("(builder)");
    });

    it("rebuilds select list when entry count changes", () => {
      state.update({ id: "a", status: "started", createdAt: new Date() });
      view.render(80);

      state.update({ id: "b", status: "started", createdAt: new Date() });
      const lines = view.render(80);
      const joined = lines.join("\n");

      expect(joined).toContain("a");
      expect(joined).toContain("b");
    });
  });

  describe("handleInput", () => {
    it("calls onDone on Escape via SelectList cancel", () => {
      state.update({ id: "a", status: "started", createdAt: new Date() });
      view.render(80); // trigger rebuild with entry

      view.handleInput("\x1b");
      expect(onDone).toHaveBeenCalled();
    });

    it("calls onSelectAgent on Enter", () => {
      state.update({ id: "builder", status: "started", createdAt: new Date() });
      view.render(80);

      view.handleInput("\r");
      expect(onSelectAgent).toHaveBeenCalledWith("builder");
    });

    it("does nothing when no select list (empty state)", () => {
      // No entries → selectList is undefined
      view.handleInput("\r");
      expect(onSelectAgent).not.toHaveBeenCalled();
      view.handleInput("\x1b");
      expect(onDone).not.toHaveBeenCalled();
    });
  });

  describe("selectedIndex", () => {
    it("delegates to selectList", () => {
      state.update({ id: "a", status: "started", createdAt: new Date() });
      state.update({ id: "b", status: "started", createdAt: new Date() });
      view.render(80);

      expect(view.selectedIndex).toBe(0);

      view.handleInput("\x1b[B"); // down arrow
      expect(view.selectedIndex).toBe(1);

      view.handleInput("\x1b[A"); // up arrow
      expect(view.selectedIndex).toBe(0);
    });

    it("returns 0 when selectList is undefined", () => {
      expect(view.selectedIndex).toBe(0);
    });

    it("setter updates selectList", () => {
      state.update({ id: "a", status: "started", createdAt: new Date() });
      state.update({ id: "b", status: "started", createdAt: new Date() });
      view.render(80);

      view.selectedIndex = 1;
      expect(view.selectedIndex).toBe(1);
    });
  });
});
