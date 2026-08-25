import { describe, expect, it } from "vitest";

import { createAccumulatedState } from "./AccumulatedState";

describe("AccumulatedState", () => {
  describe("createAccumulatedState", () => {
    it("returns an empty agent map", () => {
      const state = createAccumulatedState();
      expect(state.agentMap).toBeInstanceOf(Map);
      expect(state.agentMap.size).toBe(0);
    });

    it("sets iteration to 0", () => {
      const state = createAccumulatedState();
      expect(state.iteration).toBe(0);
    });

    it("sets maxIterations to 0", () => {
      const state = createAccumulatedState();
      expect(state.maxIterations).toBe(0);
    });

    it("leaves workspace undefined", () => {
      const state = createAccumulatedState();
      expect(state.workspace).toBeUndefined();
    });

    it("leaves branch undefined", () => {
      const state = createAccumulatedState();
      expect(state.branch).toBeUndefined();
    });

    it("leaves continueWhile undefined", () => {
      const state = createAccumulatedState();
      expect(state.continueWhile).toBeUndefined();
    });

    it("returns a fresh instance on each call", () => {
      const first = createAccumulatedState();
      const second = createAccumulatedState();
      expect(first).not.toBe(second);
      expect(first.agentMap).not.toBe(second.agentMap);
    });

    it("allows mutation of the agent map", () => {
      const state = createAccumulatedState();
      state.agentMap.set("agent-1", { status: "done" });
      expect(state.agentMap.get("agent-1")).toEqual({ status: "done" });
    });

    it("allows mutation of numeric fields", () => {
      const state = createAccumulatedState();
      state.iteration = 3;
      state.maxIterations = 5;
      expect(state.iteration).toBe(3);
      expect(state.maxIterations).toBe(5);
    });

    it("allows mutation of optional string fields", () => {
      const state = createAccumulatedState();
      state.workspace = "/tmp/ws-1";
      state.branch = "feature/foo";
      state.continueWhile = "result.passed";
      expect(state.workspace).toBe("/tmp/ws-1");
      expect(state.branch).toBe("feature/foo");
      expect(state.continueWhile).toBe("result.passed");
    });
  });
});
