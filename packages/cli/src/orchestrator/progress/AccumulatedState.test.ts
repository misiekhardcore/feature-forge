import { describe, expect, it } from "vitest";

import { createMutableState } from "./AccumulatedState";
import type { DisplayContribution } from "./DisplayContribution";
import { DisplayContributionRegistry } from "./DisplayContributionRegistry";

// ── Tests ────────────────────────────────────────────────────

describe("createMutableState", () => {
  it("returns a state with default values", () => {
    const state = createMutableState();

    expect(state.agentMap).toBeInstanceOf(Map);
    expect(state.agentMap.size).toBe(0);
    expect(state.iteration).toBe(0);
    expect(state.maxIterations).toBe(0);
    expect(state.workspacePath).toBeUndefined();
    expect(state.branch).toBeUndefined();
    expect(state.continueWhile).toBeUndefined();
  });

  it("returns a fresh state on each call (no shared references)", () => {
    const a = createMutableState();
    const b = createMutableState();

    expect(a.agentMap).not.toBe(b.agentMap);
  });
});

describe("AccumulatedState — integration with registry", () => {
  it("accumulates agent contributions into agentMap", () => {
    const registry = new DisplayContributionRegistry();
    registry.register("agent", (c, s) => {
      if (c.type !== "agent") return;
      s.agentMap.set(c.agentId, {
        status: c.agentStatus,
        summary: c.agentSummary,
        passed: c.agentPassed,
      });
    });

    const contributions: DisplayContribution[] = [
      { type: "agent", agentId: "builder", agentStatus: "started" },
      { type: "agent", agentId: "reviewer", agentStatus: "started" },
      {
        type: "agent",
        agentId: "builder",
        agentStatus: "done",
        agentPassed: true,
        agentSummary: "All good",
      },
    ];

    const state = createMutableState();
    registry.apply(state, contributions);

    expect(state.agentMap.size).toBe(2);
    expect(state.agentMap.get("builder")?.status).toBe("done");
    expect(state.agentMap.get("builder")?.passed).toBe(true);
    expect(state.agentMap.get("builder")?.summary).toBe("All good");
    expect(state.agentMap.get("reviewer")?.status).toBe("started");
  });

  it("accumulates loop contributions into iteration/maxIterations/continueWhile", () => {
    const registry = new DisplayContributionRegistry();
    registry.register("loop", (c, s) => {
      if (c.type !== "loop") return;
      s.iteration = c.iteration;
      s.maxIterations = c.maxIterations;
      if (c.continueWhile !== undefined) s.continueWhile = c.continueWhile;
    });

    const contributions: DisplayContribution[] = [
      { type: "loop", iteration: 0, maxIterations: 5, continueWhile: "result.passed" },
      { type: "loop", iteration: 2, maxIterations: 5, continueWhile: "result.passed" },
    ];

    const state = createMutableState();
    registry.apply(state, contributions);

    expect(state.iteration).toBe(2);
    expect(state.maxIterations).toBe(5);
    expect(state.continueWhile).toBe("result.passed");
  });

  it("accumulates workspace contributions into workspacePath and branch", () => {
    const registry = new DisplayContributionRegistry();
    registry.register("workspace", (c, s) => {
      if (c.type !== "workspace") return;
      s.workspacePath = c.workspace;
      s.branch = c.branch;
    });

    const contributions: DisplayContribution[] = [
      { type: "workspace", workspace: "/tmp/ws-1", branch: "forge/ws-1" },
    ];

    const state = createMutableState();
    registry.apply(state, contributions);

    expect(state.workspacePath).toBe("/tmp/ws-1");
    expect(state.branch).toBe("forge/ws-1");
  });

  it("silently skips status contributions (no structural state)", () => {
    const registry = new DisplayContributionRegistry();
    registry.register("agent", (_c, _s) => {
      /* no-op */
    });

    const contributions: DisplayContribution[] = [
      { type: "status", phase: "cleanup-done", message: "Cleaned" },
    ];

    const state = createMutableState();
    registry.apply(state, contributions);

    expect(state.agentMap.size).toBe(0);
    expect(state.workspacePath).toBeUndefined();
  });

  it("overwrites earlier values with later contributions", () => {
    const registry = new DisplayContributionRegistry();
    registry.register("agent", (c, s) => {
      if (c.type !== "agent") return;
      s.agentMap.set(c.agentId, {
        status: c.agentStatus,
        summary: c.agentSummary,
        passed: c.agentPassed,
      });
    });
    registry.register("workspace", (c, s) => {
      if (c.type !== "workspace") return;
      s.workspacePath = c.workspace;
      s.branch = c.branch;
    });

    const contributions: DisplayContribution[] = [
      { type: "agent", agentId: "a1", agentStatus: "started" },
      { type: "workspace", workspace: "/tmp/old", branch: "forge/old" },
      { type: "agent", agentId: "a1", agentStatus: "done", agentPassed: true },
      { type: "workspace", workspace: "/tmp/new", branch: "forge/new" },
    ];

    const state = createMutableState();
    registry.apply(state, contributions);

    expect(state.agentMap.get("a1")?.status).toBe("done");
    expect(state.workspacePath).toBe("/tmp/new");
    expect(state.branch).toBe("forge/new");
  });

  it("handles contributions without a registered handler gracefully", () => {
    const registry = new DisplayContributionRegistry();

    const contributions: DisplayContribution[] = [
      { type: "agent", agentId: "a1", agentStatus: "done" },
    ];

    // No handlers registered — should not throw
    const state = createMutableState();
    expect(() => registry.apply(state, contributions)).not.toThrow();
    expect(state.agentMap.size).toBe(0);
  });

  it("handles empty contributions array", () => {
    const registry = new DisplayContributionRegistry();
    registry.register("agent", (_c, _s) => {
      /* no-op */
    });

    const state = createMutableState();
    registry.apply(state, []);

    expect(state.agentMap.size).toBe(0);
    expect(state.iteration).toBe(0);
  });

  it("picks the latest continueWhile from multiple loop contributions", () => {
    const registry = new DisplayContributionRegistry();
    registry.register("loop", (c, s) => {
      if (c.type !== "loop") return;
      s.iteration = c.iteration;
      s.maxIterations = c.maxIterations;
      if (c.continueWhile !== undefined) s.continueWhile = c.continueWhile;
    });

    const contributions: DisplayContribution[] = [
      { type: "loop", iteration: 0, maxIterations: 3, continueWhile: "a" },
      { type: "loop", iteration: 1, maxIterations: 3 },
      { type: "loop", iteration: 2, maxIterations: 3, continueWhile: "b" },
    ];

    const state = createMutableState();
    registry.apply(state, contributions);

    expect(state.iteration).toBe(2);
    expect(state.continueWhile).toBe("b");
  });
});
