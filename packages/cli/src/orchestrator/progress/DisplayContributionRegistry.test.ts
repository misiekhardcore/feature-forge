import { describe, expect, it, vi } from "vitest";

import { createAccumulatedState } from "./AccumulatedState";
import type {
  AgentContribution,
  DisplayContribution,
  LoopContribution,
  WorkspaceContribution,
} from "./DisplayContribution";
import { DisplayContributionRegistry } from "./DisplayContributionRegistry";

function makeAgentContribution(overrides?: Partial<AgentContribution>): AgentContribution {
  return {
    type: "agent",
    agentId: "agent-1",
    agentStatus: "done",
    agentSummary: "completed task",
    phase: "agent-done",
    message: "Agent agent-1 completed",
    ...overrides,
  };
}

function makeLoopContribution(overrides?: Partial<LoopContribution>): LoopContribution {
  return {
    type: "loop",
    iteration: 0,
    maxIterations: 3,
    phase: "loop-round-start",
    message: "Loop round",
    ...overrides,
  };
}

function makeWorkspaceContribution(
  overrides?: Partial<WorkspaceContribution>,
): WorkspaceContribution {
  return {
    type: "workspace",
    workspace: "/tmp/ws-1",
    phase: "workspace-ready",
    message: "Workspace ready",
    ...overrides,
  };
}

describe("DisplayContributionRegistry", () => {
  describe("register", () => {
    it("stores a handler for the given type", () => {
      const registry = new DisplayContributionRegistry();
      const handler = vi.fn();
      registry.register("agent", handler);
      // No direct getter — exercise through apply
      const state = createAccumulatedState();
      registry.apply(state, [makeAgentContribution()]);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("overwrites a handler when registering the same type twice", () => {
      const registry = new DisplayContributionRegistry();
      const firstHandler = vi.fn();
      const secondHandler = vi.fn();
      registry.register("agent", firstHandler);
      registry.register("agent", secondHandler);
      const state = createAccumulatedState();
      registry.apply(state, [makeAgentContribution()]);
      expect(firstHandler).not.toHaveBeenCalled();
      expect(secondHandler).toHaveBeenCalledTimes(1);
    });

    it("allows registering handlers for multiple types", () => {
      const registry = new DisplayContributionRegistry();
      const agentHandler = vi.fn();
      const loopHandler = vi.fn();
      registry.register("agent", agentHandler);
      registry.register("loop", loopHandler);
      const state = createAccumulatedState();
      registry.apply(state, [makeAgentContribution(), makeLoopContribution()]);
      expect(agentHandler).toHaveBeenCalledTimes(1);
      expect(loopHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe("apply", () => {
    it("calls the handler for each matching contribution", () => {
      const registry = new DisplayContributionRegistry();
      const handler = vi.fn();
      registry.register("agent", handler);
      const contributions = [
        makeAgentContribution({ agentId: "a1" }),
        makeAgentContribution({ agentId: "a2" }),
        makeAgentContribution({ agentId: "a3" }),
      ];
      const state = createAccumulatedState();
      registry.apply(state, contributions);
      expect(handler).toHaveBeenCalledTimes(3);
    });

    it("passes the state and contribution to the handler", () => {
      const registry = new DisplayContributionRegistry();
      const handler = vi.fn();
      registry.register("agent", handler);
      const contribution = makeAgentContribution({ agentId: "test-agent" });
      const state = createAccumulatedState();
      registry.apply(state, [contribution]);
      expect(handler).toHaveBeenCalledWith(state, contribution);
    });

    it("skips contributions with no registered handler", () => {
      const registry = new DisplayContributionRegistry();
      const handler = vi.fn();
      registry.register("agent", handler);
      const contributions: DisplayContribution[] = [
        makeAgentContribution(),
        { type: "status", phase: "unknown", message: "test" },
        makeLoopContribution(),
      ];
      const state = createAccumulatedState();
      expect(() => registry.apply(state, contributions)).not.toThrow();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("calls handlers in contribution order", () => {
      const registry = new DisplayContributionRegistry();
      const callOrder: string[] = [];
      registry.register("agent", (_state, contribution) => {
        if (contribution.type === "agent") {
          callOrder.push(contribution.agentId);
        }
      });
      const contributions = [
        makeAgentContribution({ agentId: "first" }),
        makeAgentContribution({ agentId: "second" }),
        makeAgentContribution({ agentId: "third" }),
      ];
      const state = createAccumulatedState();
      registry.apply(state, contributions);
      expect(callOrder).toEqual(["first", "second", "third"]);
    });

    it("applies an agent handler that populates the agent map", () => {
      const registry = new DisplayContributionRegistry();
      registry.register("agent", (state, contribution) => {
        if (contribution.type === "agent" && contribution.agentId && contribution.agentStatus) {
          state.agentMap.set(contribution.agentId, {
            status: contribution.agentStatus,
            summary: contribution.agentSummary,
            passed: contribution.agentPassed,
          });
        }
      });
      const state = createAccumulatedState();
      registry.apply(state, [makeAgentContribution({ agentId: "a1", agentStatus: "done" })]);
      expect(state.agentMap.get("a1")).toEqual({
        status: "done",
        summary: "completed task",
        passed: undefined,
      });
    });

    it("applies a loop handler that updates iteration info", () => {
      const registry = new DisplayContributionRegistry();
      registry.register("loop", (state, contribution) => {
        if (contribution.type === "loop") {
          state.iteration = contribution.iteration;
          state.maxIterations = contribution.maxIterations;
        }
      });
      const state = createAccumulatedState();
      registry.apply(state, [makeLoopContribution({ iteration: 2, maxIterations: 5 })]);
      expect(state.iteration).toBe(2);
      expect(state.maxIterations).toBe(5);
    });

    it("applies a workspace handler that updates workspace and branch", () => {
      const registry = new DisplayContributionRegistry();
      registry.register("workspace", (state, contribution) => {
        if (contribution.type === "workspace") {
          state.workspace = contribution.workspace;
          state.branch = contribution.branch;
        }
      });
      const state = createAccumulatedState();
      registry.apply(state, [makeWorkspaceContribution({ branch: "feature/test" })]);
      expect(state.workspace).toBe("/tmp/ws-1");
      expect(state.branch).toBe("feature/test");
    });

    it("handles an empty contributions array", () => {
      const registry = new DisplayContributionRegistry();
      const state = createAccumulatedState();
      expect(() => registry.apply(state, [])).not.toThrow();
    });

    it("handles contributions with no registered types gracefully", () => {
      const registry = new DisplayContributionRegistry();
      const state = createAccumulatedState();
      const contributions: DisplayContribution[] = [
        { type: "status", phase: "unknown-1", message: "test" },
        { type: "status", phase: "unknown-2", message: "test" },
      ];
      expect(() => registry.apply(state, contributions)).not.toThrow();
    });
  });
});
