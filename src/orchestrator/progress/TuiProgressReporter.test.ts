import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { NoOpProgressReporter } from "./NoOpProgressReporter";
import type { ProgressEvent } from "./ProgressEvent";
import { ProgressReporter } from "./ProgressReporter";
import { TuiProgressReporter } from "./TuiProgressReporter";

// ── Helpers ──────────────────────────────────────────────────

function makeEvent(overrides: Partial<ProgressEvent> = {}): ProgressEvent {
  return {
    routineName: "build",
    phase: "agent-started",
    message: "Agent started",
    iteration: 0,
    maxIterations: 3,
    ...overrides,
  };
}

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

describe("TuiProgressReporter", () => {
  describe("constructor", () => {
    it("accepts ctx, routineName, maxIterations, continueWhile, and onStateChange", () => {
      const ctx = makeMockCtx();
      const onStateChange = vi.fn();
      const reporter = new TuiProgressReporter({
        ctx,
        routineName: "build",
        maxIterations: 3,
        continueWhile: "results.x === true",
        onStateChange,
      });

      expect(reporter).toBeInstanceOf(ProgressReporter);
    });
  });

  describe("update", () => {
    it("calls ctx.ui.setWidget with a render factory on first update", () => {
      const ctx = makeMockCtx();
      const reporter = new TuiProgressReporter({
        ctx,
        routineName: "build",
        maxIterations: 3,
      });
      reporter.update(makeEvent());

      expect(ctx.ui.setWidget).toHaveBeenCalledTimes(1);
      const call = (ctx.ui.setWidget as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[0]).toBe("forge-run");
      expect(call[1]).toBeInstanceOf(Function);
    });

    it("calls ctx.ui.setStatus with a compact status line", () => {
      const ctx = makeMockCtx();
      const reporter = new TuiProgressReporter({
        ctx,
        routineName: "build",
        maxIterations: 3,
      });
      reporter.update(makeEvent());

      expect(ctx.ui.setStatus).toHaveBeenCalledTimes(1);
      expect(ctx.ui.setStatus).toHaveBeenCalledWith("feature-forge", expect.any(String));
    });

    it("tracks agent status changes across multiple updates", () => {
      const ctx = makeMockCtx();
      const reporter = new TuiProgressReporter({
        ctx,
        routineName: "build",
        maxIterations: 3,
      });

      reporter.update(
        makeEvent({
          phase: "agent-started",
          message: "Agent started",
          agentId: "builder",
          agentStatus: "started",
        }),
      );
      reporter.update(
        makeEvent({
          phase: "agent-done",
          message: "Agent done",
          agentId: "builder",
          agentStatus: "done",
          agentSummary: "Built successfully",
        }),
      );

      const state = reporter.getState();
      expect(state.agents.has("builder")).toBe(true);
      expect(state.agents.get("builder")?.status).toBe("done");
      expect(state.agents.get("builder")?.summary).toBe("Built successfully");
    });

    it("tracks iteration changes", () => {
      const ctx = makeMockCtx();
      const reporter = new TuiProgressReporter({
        ctx,
        routineName: "build",
        maxIterations: 3,
      });

      reporter.update(makeEvent({ iteration: 0 }));
      reporter.update(makeEvent({ iteration: 1 }));

      const state = reporter.getState();
      expect(state.iteration).toBe(1);
    });

    it("tracks workspace extraction", () => {
      const ctx = makeMockCtx();
      const reporter = new TuiProgressReporter({
        ctx,
        routineName: "build",
        maxIterations: 3,
      });

      reporter.update(makeEvent({ workspace: "/tmp/ws-build" }));

      const state = reporter.getState();
      expect(state.workspace).toBe("/tmp/ws-build");
    });

    it("calls onStateChange callback on each update", () => {
      const ctx = makeMockCtx();
      const onStateChange = vi.fn();
      const reporter = new TuiProgressReporter({
        ctx,
        routineName: "build",
        maxIterations: 3,
        onStateChange,
      });

      reporter.update(makeEvent());
      reporter.update(makeEvent());

      expect(onStateChange).toHaveBeenCalledTimes(2);
    });

    it("throttles widget renders to ~4/s", async () => {
      vi.useFakeTimers();
      try {
        const ctx = makeMockCtx();
        const reporter = new TuiProgressReporter({
          ctx,
          routineName: "build",
          maxIterations: 3,
        });

        // Send many events rapidly
        for (let index = 0; index < 20; index++) {
          reporter.update(makeEvent({ iteration: index }));
        }

        // First event triggers immediate render; subsequent events are throttled.
        // All events within the same ~250ms window should produce at most 2 widget
        // calls: one immediate, one scheduled via setTimeout.
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
      const reporter = new TuiProgressReporter({
        ctx,
        routineName: "build",
        maxIterations: 3,
      });

      reporter.update(makeEvent());
      reporter.clear();

      expect(ctx.ui.setWidget).toHaveBeenLastCalledWith("forge-run", undefined);
      expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("feature-forge", undefined);
    });

    it("prevents pending throttle timer from re-showing widget after clear", async () => {
      vi.useFakeTimers();
      try {
        const ctx = makeMockCtx();
        const reporter = new TuiProgressReporter({
          ctx,
          routineName: "build",
          maxIterations: 3,
        });

        // First update triggers immediate render.
        reporter.update(makeEvent());

        // Second update within throttle window schedules a deferred render.
        reporter.update(makeEvent());
        const widgetCallsBeforeClear = (ctx.ui.setWidget as ReturnType<typeof vi.fn>).mock.calls
          .length;

        // Clear before the timer fires.
        reporter.clear();
        const clearCallArgs = (ctx.ui.setWidget as ReturnType<typeof vi.fn>).mock.calls[
          (ctx.ui.setWidget as ReturnType<typeof vi.fn>).mock.calls.length - 1
        ];
        expect(clearCallArgs[0]).toBe("forge-run");
        expect(clearCallArgs[1]).toBeUndefined();

        // Advance past the throttle interval — the deferred render must
        // have been cancelled by clear().
        await vi.advanceTimersByTimeAsync(300);

        // No additional widget calls should have been made.
        const widgetCallsAfterTimer = (ctx.ui.setWidget as ReturnType<typeof vi.fn>).mock.calls
          .length;
        expect(widgetCallsAfterTimer).toBe(widgetCallsBeforeClear + 1); // only the clear call
      } finally {
        vi.useRealTimers();
      }
    });

    it("removes widget even if never updated", () => {
      const ctx = makeMockCtx();
      const reporter = new TuiProgressReporter({
        ctx,
        routineName: "build",
        maxIterations: 3,
      });

      reporter.clear();

      expect(ctx.ui.setWidget).toHaveBeenCalledWith("forge-run", undefined);
      expect(ctx.ui.setStatus).toHaveBeenCalledWith("feature-forge", undefined);
    });
  });

  describe("getState", () => {
    it("returns accumulated state after updates", () => {
      const ctx = makeMockCtx();
      const reporter = new TuiProgressReporter({
        ctx,
        routineName: "build",
        maxIterations: 3,
      });

      reporter.update(
        makeEvent({
          routineName: "build",
          phase: "agent-done",
          message: "Done",
          iteration: 2,
          agentId: "builder",
          agentStatus: "done",
          agentSummary: "ok",
          workspace: "/tmp/ws",
        }),
      );

      const state = reporter.getState();
      expect(state.routineName).toBe("build");
      expect(state.phase).toBe("agent-done");
      expect(state.iteration).toBe(2);
      expect(state.maxIterations).toBe(3);
      expect(state.workspace).toBe("/tmp/ws");
      expect(state.agents.get("builder")?.status).toBe("done");
    });
  });

  describe("renderWidget", () => {
    it("returns correct lines via buildWidgetLines", () => {
      const lines = TuiProgressReporter.buildWidgetLines({
        theme: {
          fg: vi.fn((_color: string, text: string) => text),
        } as unknown as Theme,
        routineName: "build",
        maxIterations: 3,
        iteration: 1,
        agents: new Map([
          ["builder", { status: "done", summary: "Built" }],
          ["reviewer", { status: "started" }],
        ]),
        continueWhile: "results.x",
        workspace: "/tmp/ws",
      });

      expect(lines).toContain("⟳ build iteration 2/3");
      expect(lines.some((l) => l.includes("builder") && l.includes("Built"))).toBe(true);
      expect(lines.some((l) => l.includes("reviewer"))).toBe(true);
      expect(lines.some((l) => l.includes("while: results.x"))).toBe(true);
      expect(lines.some((l) => l.includes("ws: /tmp/ws"))).toBe(true);
    });

    it("handles no agents gracefully", () => {
      const lines = TuiProgressReporter.buildWidgetLines({
        theme: {
          fg: vi.fn((_color: string, text: string) => text),
        } as unknown as Theme,
        routineName: "build",
        maxIterations: 0,
        iteration: 0,
        agents: new Map(),
      });

      expect(lines.some((l) => l.includes("no agents yet"))).toBe(true);
    });
  });
});

describe("NoOpProgressReporter", () => {
  it("update does not throw", () => {
    const reporter = new NoOpProgressReporter();
    expect(() => reporter.update(makeEvent())).not.toThrow();
  });

  it("clear does not throw", () => {
    const reporter = new NoOpProgressReporter();
    expect(() => reporter.clear()).not.toThrow();
  });

  it("getState returns default empty snapshot", () => {
    const reporter = new NoOpProgressReporter();
    const state = reporter.getState();
    expect(state.routineName).toBe("");
    expect(state.iteration).toBe(0);
    expect(state.maxIterations).toBe(0);
    expect(state.agents.size).toBe(0);
  });
});
