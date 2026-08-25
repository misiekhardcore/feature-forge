import type { RoutineProgressEvent } from "@feature-forge/core/routines";
import { describe, expect, it } from "vitest";

import type { AccumulatedState } from "./AccumulatedState";
import { createAccumulatedState } from "./AccumulatedState";
import { applyEvent } from "./DisplayProjection";

function fold(events: RoutineProgressEvent[]): AccumulatedState {
  const state = createAccumulatedState();
  for (const event of events) {
    applyEvent(state, event);
  }
  return state;
}

describe("DisplayProjection.applyEvent", () => {
  describe("agent events", () => {
    it("sets status to started on agent-started", () => {
      const state = fold([
        {
          phase: "agent-started",
          message: 'Agent "builder" (build) started',
          details: { executionId: "exec-1", agentId: "builder" },
        },
      ]);
      expect(state.agentMap.get("builder")).toEqual({ status: "started" });
    });

    it("sets status, summary and passed on agent-done", () => {
      const state = fold([
        {
          phase: "agent-done",
          message: 'Agent "reviewer" completed',
          details: {
            executionId: "exec-1",
            agentId: "reviewer",
            summary: "All good",
            passed: true,
          },
        },
      ]);
      expect(state.agentMap.get("reviewer")).toEqual({
        status: "done",
        summary: "All good",
        passed: true,
      });
    });

    it("overwrites a started entry with the done entry", () => {
      const state = fold([
        {
          phase: "agent-started",
          message: 'Agent "builder" (build) started',
          details: { executionId: "exec-1", agentId: "builder" },
        },
        {
          phase: "agent-done",
          message: 'Agent "builder" completed',
          details: { executionId: "exec-1", agentId: "builder", summary: "ok", passed: false },
        },
      ]);
      expect(state.agentMap.get("builder")).toEqual({
        status: "done",
        summary: "ok",
        passed: false,
      });
    });

    it("is a no-op for agent-started/done without agentId", () => {
      const state = fold([
        // @ts-expect-error testing edge case
        { phase: "agent-started", message: "started", details: {} },
        // @ts-expect-error testing edge case
        { phase: "agent-done", message: "done", details: { summary: "x" } },
      ]);
      expect(state.agentMap.size).toBe(0);
    });

    it("is a no-op for agent-stream events", () => {
      const state = fold([
        {
          phase: "agent-started",
          message: 'Agent "builder" (build) started',
          details: { executionId: "exec-1", agentId: "builder" },
        },
        {
          phase: "agent-stream",
          message: 'tool_call: read("file.ts")',
          details: {
            executionId: "exec-1",
            agentId: "builder",
            label: "builder",
            event: { type: "agent_start" },
          },
        },
      ]);
      // Stream chunks carry no state transition.
      expect(state.agentMap.get("builder")).toEqual({ status: "started" });
    });
  });

  describe("loop events", () => {
    it("maps round to 0-based iteration and captures maxIterations + continueWhile", () => {
      const state = fold([
        {
          phase: "loop-round-start",
          message: 'Loop "l" — round 1/3',
          details: { round: 1, maxIterations: 3, continueWhile: "result.passed" },
        },
      ]);
      expect(state.iteration).toBe(0);
      expect(state.maxIterations).toBe(3);
      expect(state.continueWhile).toBe("result.passed");
    });

    it("handles loop-round-complete with the same semantics", () => {
      const state = fold([
        {
          phase: "loop-round-complete",
          message: 'Loop "l" — round 3 complete',
          details: { round: 3, maxIterations: 3 },
        },
      ]);
      expect(state.iteration).toBe(2);
      expect(state.maxIterations).toBe(3);
    });

    it("defaults round to 1 when missing", () => {
      const state = fold([
        // @ts-expect-error testing edge case
        { phase: "loop-round-start", message: "Loop started", details: {} },
      ]);
      expect(state.iteration).toBe(0);
    });

    it("does not touch maxIterations when details lack a numeric value", () => {
      const state = createAccumulatedState();
      state.maxIterations = 5;
      applyEvent(state, {
        phase: "loop-round-start",
        message: "Loop started",
        details: { round: 2 },
      } as RoutineProgressEvent);
      expect(state.iteration).toBe(1);
      expect(state.maxIterations).toBe(5);
    });

    it("only sets continueWhile when present", () => {
      const state = fold([
        {
          phase: "loop-round-start",
          message: 'Loop "l" — round 1/2',
          details: { round: 1, maxIterations: 2 },
        },
      ]);
      expect(state.iteration).toBe(0);
      expect(state.continueWhile).toBeUndefined();
    });
  });

  describe("workspace events", () => {
    it("captures path and branch from workspace-ready", () => {
      const state = fold([
        {
          phase: "workspace-ready",
          message: "Workspace ready",
          details: { path: "/tmp/ws-abc", branch: "forge/ws-abc" },
        },
      ]);
      expect(state.workspace).toBe("/tmp/ws-abc");
      expect(state.branch).toBe("forge/ws-abc");
    });

    it("does not set workspace when path is not a string", () => {
      const state = fold([
        {
          phase: "workspace-ready",
          message: "Workspace ready",
          details: { path: 42, branch: "b" },
        } as unknown as RoutineProgressEvent,
      ]);
      expect(state.workspace).toBeUndefined();
      expect(state.branch).toBe("b");
    });

    it("does not set branch when absent", () => {
      const state = fold([
        {
          phase: "workspace-ready",
          message: "Workspace ready",
          details: { path: "/tmp/ws" },
        } as unknown as RoutineProgressEvent,
      ]);
      expect(state.workspace).toBe("/tmp/ws");
      expect(state.branch).toBeUndefined();
    });
  });

  describe("cleanup events", () => {
    it("captures the workspace path from cleanup-done", () => {
      const state = fold([
        {
          phase: "cleanup-done",
          message: "Cleanup completed",
          details: { workspace: "/tmp/ws-abc" },
        },
      ]);
      expect(state.workspace).toBe("/tmp/ws-abc");
    });

    it("is a no-op when cleanup-done has no string workspace", () => {
      const state = fold([{ phase: "cleanup-done", message: "Cleanup completed", details: {} }]);
      expect(state.workspace).toBeUndefined();
    });
  });

  describe("session events", () => {
    it("accumulates a comma-joined resultSnippet across multiple events", () => {
      const state = fold([
        {
          phase: "session-set",
          message: "Session param set: a: 1",
          details: { key: "a", value: "1" },
        },
        {
          phase: "session-set",
          message: "Session param set: b: 2",
          details: { key: "b", value: "2" },
        },
      ]);
      expect(state.resultSnippet).toBe("a: 1, b: 2");
    });

    it("sets resultSnippet from a single event", () => {
      const state = fold([
        {
          phase: "session-set",
          message: "Session param set: ws: /tmp/forge-ws",
          details: { key: "ws", value: "/tmp/forge-ws" },
        },
      ]);
      expect(state.resultSnippet).toBe("ws: /tmp/forge-ws");
    });
  });

  describe("routine-ref events", () => {
    it("pushes the flow name on routine-ref-start", () => {
      const state = fold([
        {
          phase: "routine-ref-start",
          message: "starting review",
          details: { instructionId: "r", target: "review", flow: "review" },
        },
      ]);
      expect(state.routineRefs).toEqual(["review"]);
    });

    it("accumulates multiple routine refs in order", () => {
      const state = fold([
        {
          phase: "routine-ref-start",
          message: "starting review",
          details: { instructionId: "r1", target: "review", flow: "review" },
        },
        {
          phase: "routine-ref-start",
          message: "starting verify",
          details: { instructionId: "r2", target: "verify", flow: "verify" },
        },
      ]);
      expect(state.routineRefs).toEqual(["review", "verify"]);
    });

    it("is a no-op when flow is falsy", () => {
      const state = fold([
        {
          phase: "routine-ref-start",
          message: "starting",
          details: { instructionId: "r", target: "review", flow: "" },
        } as unknown as RoutineProgressEvent,
      ]);
      expect(state.routineRefs).toEqual([]);
    });

    it("is a no-op for routine-ref-done and routine-ref-error", () => {
      const state = fold([
        {
          phase: "routine-ref-done",
          message: "done",
          details: { instructionId: "r", target: "review", flow: "review", passed: true },
        },
        {
          phase: "routine-ref-error",
          message: "error",
          details: { instructionId: "r", target: "review", flow: "review", stepId: "s" },
        },
      ]);
      expect(state.routineRefs).toEqual([]);
    });
  });

  describe("no-op phases", () => {
    it("ignores shell-done", () => {
      const state = fold([
        {
          phase: "shell-done",
          message: "Shell completed",
          details: { passed: true, summary: "", prUrl: "https://github.com/owner/repo/pull/1" },
        },
      ]);
      expect(state.agentMap.size).toBe(0);
      expect(state.iteration).toBe(0);
      expect(state.workspace).toBeUndefined();
      expect(state.resultSnippet).toBeUndefined();
    });

    it("ignores parallel and git phases", () => {
      const state = fold([
        { phase: "parallel-start", message: "parallel", details: {} },
        { phase: "parallel-done", message: "parallel done", details: {} },
        { phase: "git-start", message: "git", details: {} },
        { phase: "git-done", message: "git done", details: { passed: true, summary: "" } },
        { phase: "cleanup-start", message: "cleanup", details: {} },
        { phase: "shell-start", message: "shell", details: {} },
      ]);
      expect(state.agentMap.size).toBe(0);
      expect(state.iteration).toBe(0);
      expect(state.maxIterations).toBe(0);
      expect(state.workspace).toBeUndefined();
      expect(state.routineRefs).toEqual([]);
    });
  });
});
