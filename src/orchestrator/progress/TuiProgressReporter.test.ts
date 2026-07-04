import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { TuiRoutineWidget } from "./TuiProgressReporter";

// ── Helpers ──────────────────────────────────────────────────

function makeMockCtx(): ExtensionContext {
  const setWidget = vi.fn();
  const setStatus = vi.fn();
  return {
    ui: {
      setWidget,
      setStatus,
      theme: {
        fg: vi.fn((_color: string, text: string) => text),
      },
    },
    mode: "tui",
    hasUI: true,
    cwd: "/tmp",
  } as unknown as ExtensionContext;
}

// ── Tests ────────────────────────────────────────────────────

describe("TuiRoutineWidget", () => {
  describe("constructor", () => {
    it("accepts ctx and optional onStateChange", () => {
      const ctx = makeMockCtx();
      const onStateChange = vi.fn();
      const widget = new TuiRoutineWidget({ ctx, onStateChange });

      expect(widget).toBeInstanceOf(TuiRoutineWidget);
    });
  });

  describe("render", () => {
    it("calls ctx.ui.setStatus with the status text", () => {
      const ctx = makeMockCtx();
      const widget = new TuiRoutineWidget({ ctx });

      widget.render(["line 1", "line 2"], "⟳ build · ⏳ builder");

      expect(ctx.ui.setStatus).toHaveBeenCalledWith("feature-forge", "⟳ build · ⏳ builder");
    });

    it("calls ctx.ui.setWidget with a render factory", () => {
      const ctx = makeMockCtx();
      const widget = new TuiRoutineWidget({ ctx });

      widget.render(["line 1"], "status");

      expect(ctx.ui.setWidget).toHaveBeenCalledTimes(1);
      const call = (ctx.ui.setWidget as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe("forge-run");
      expect(call[1]).toBeInstanceOf(Function);
      expect(call[2]).toEqual({ placement: "aboveEditor" });
    });

    it("returns lines passed in from the render factory created by setWidget", () => {
      const ctx = makeMockCtx();
      const widget = new TuiRoutineWidget({ ctx });
      const lines = ["⟳ build", "─────────", "  ✓ builder"];

      widget.render(lines, "status");

      const renderFn = (ctx.ui.setWidget as ReturnType<typeof vi.fn>).mock.calls[0][1];
      const component = renderFn({}, { fg: vi.fn() });
      const renderedLines = component.render(80);
      expect(renderedLines).toEqual(lines);
    });

    it("calls onStateChange callback after each render", () => {
      const ctx = makeMockCtx();
      const onStateChange = vi.fn();
      const widget = new TuiRoutineWidget({ ctx, onStateChange });

      widget.render([], "status");
      widget.render([], "status2");

      expect(onStateChange).toHaveBeenCalledTimes(2);
    });

    it("throttles widget renders to ~4/s", async () => {
      vi.useFakeTimers();
      try {
        const ctx = makeMockCtx();
        const widget = new TuiRoutineWidget({ ctx });

        // Send many render calls rapidly
        for (let index = 0; index < 20; index++) {
          widget.render(["line"], `status ${index}`);
        }

        // First call triggers immediate render; subsequent calls are throttled.
        const widgetCallsBeforeTimeout = (ctx.ui.setWidget as ReturnType<typeof vi.fn>).mock.calls
          .length;
        expect(widgetCallsBeforeTimeout).toBeLessThanOrEqual(2);

        // Advance past the throttle interval
        await vi.advanceTimersByTimeAsync(300);

        // The deferred one should have fired by now
        const widgetCallsAfter = (ctx.ui.setWidget as ReturnType<typeof vi.fn>).mock.calls.length;
        expect(widgetCallsAfter).toBeGreaterThanOrEqual(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("clear", () => {
    it("removes the widget and status", () => {
      const ctx = makeMockCtx();
      const widget = new TuiRoutineWidget({ ctx });

      widget.render(["line"], "status");
      widget.clear();

      expect(ctx.ui.setWidget).toHaveBeenLastCalledWith("forge-run", undefined);
      expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("feature-forge", undefined);
    });

    it("cancels pending throttle timer so no re-render occurs after clear", async () => {
      vi.useFakeTimers();
      try {
        const ctx = makeMockCtx();
        const widget = new TuiRoutineWidget({ ctx });

        // First render triggers immediate widget render.
        widget.render(["line 1"], "s1");

        // Second render within throttle window schedules a deferred render.
        widget.render(["line 2"], "s2");
        const widgetCallsBeforeClear = (ctx.ui.setWidget as ReturnType<typeof vi.fn>).mock.calls
          .length;

        // Clear before timer fires.
        widget.clear();

        const allCalls = (ctx.ui.setWidget as ReturnType<typeof vi.fn>).mock.calls;
        const lastCall = allCalls[allCalls.length - 1];
        expect(lastCall[0]).toBe("forge-run");
        expect(lastCall[1]).toBeUndefined();

        // Advance past throttle interval — deferred render must be cancelled.
        await vi.advanceTimersByTimeAsync(300);

        const widgetCallsAfterTimer = (ctx.ui.setWidget as ReturnType<typeof vi.fn>).mock.calls
          .length;
        expect(widgetCallsAfterTimer).toBe(widgetCallsBeforeClear + 1); // only the clear call
      } finally {
        vi.useRealTimers();
      }
    });

    it("removes widget even if never rendered", () => {
      const ctx = makeMockCtx();
      const widget = new TuiRoutineWidget({ ctx });

      widget.clear();

      expect(ctx.ui.setWidget).toHaveBeenCalledWith("forge-run", undefined);
      expect(ctx.ui.setStatus).toHaveBeenCalledWith("feature-forge", undefined);
    });
  });
});
