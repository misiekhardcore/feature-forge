import { describe, expect, it, vi } from "vitest";

import { makeMockTypedEventBus } from "../../test-utils";
import { FlowContext } from "../FlowContext";
import type { RoutineRefInstruction } from "../FlowInstruction";
import { createAccumulatedState } from "../progress/AccumulatedState";
import { DisplayContributionRegistry } from "../progress/DisplayContributionRegistry";
import { RoutineRefStepExecutor } from "./RoutineRefStepExecutor";

describe("RoutineRefStepExecutor", () => {
  describe("type", () => {
    it("has type 'routine'", () => {
      const executor = new RoutineRefStepExecutor();
      expect(executor.type).toBe("routine");
    });
  });

  describe("execute", () => {
    it("throws a descriptive error when called (not yet implemented)", async () => {
      const executor = new RoutineRefStepExecutor();

      const instruction: RoutineRefInstruction = {
        type: "routine",
        id: "r1",
        target: "flow-a",
        routine: "build",
      };
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      await expect(
        executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus()),
      ).rejects.toThrow("RoutineRefStepExecutor is not yet implemented");
    });

    it("matches the StepExecutor contract (returns Promise<FlowContext>)", async () => {
      const executor = new RoutineRefStepExecutor();
      expect(executor.execute).toBeDefined();
      // Contract: execute returns a Promise (even though this one rejects)
      const instruction: RoutineRefInstruction = {
        type: "routine",
        id: "r2",
        target: "flow-b",
        routine: "review",
      };
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      const result = executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());
      expect(result).toBeInstanceOf(Promise);
      await expect(result).rejects.toThrow();
    });
  });

  describe("getDisplayContribution", () => {
    it("returns undefined for non-routine-ref events", () => {
      const executor = new RoutineRefStepExecutor();

      const result = executor.getDisplayContribution({
        phase: "agent-started",
        message: "started",
        details: { executionId: "e1", agentId: "a1" },
      });

      expect(result).toBeUndefined();
    });

    it("returns a started contribution for routine-ref-start", () => {
      const executor = new RoutineRefStepExecutor();

      const result = executor.getDisplayContribution({
        phase: "routine-ref-start",
        message: "Starting ref to flow-a/build",
        details: { instructionId: "r1", target: "flow-a", routine: "build" },
      });

      expect(result).toEqual({
        type: "routine-ref",
        target: "flow-a",
        routine: "build",
        status: "started",
        phase: "routine-ref-start",
        message: "Starting ref to flow-a/build",
      });
    });

    it("returns a done contribution for routine-ref-done", () => {
      const executor = new RoutineRefStepExecutor();

      const result = executor.getDisplayContribution({
        phase: "routine-ref-done",
        message: "Ref to flow-a/build completed",
        details: { instructionId: "r1", target: "flow-a", routine: "build", passed: true },
      });

      expect(result).toEqual({
        type: "routine-ref",
        target: "flow-a",
        routine: "build",
        status: "done",
        phase: "routine-ref-done",
        message: "Ref to flow-a/build completed",
      });
    });

    it("returns an error contribution for routine-ref-error", () => {
      const executor = new RoutineRefStepExecutor();

      const result = executor.getDisplayContribution({
        phase: "routine-ref-error",
        message: "Ref to flow-a/build failed",
        details: { instructionId: "r1", target: "flow-a", routine: "build" },
      });

      expect(result).toEqual({
        type: "routine-ref",
        target: "flow-a",
        routine: "build",
        status: "error",
        phase: "routine-ref-error",
        message: "Ref to flow-a/build failed",
      });
    });
  });

  describe("registerDisplayHandler", () => {
    it("appends target:routine to state.routineRefs for routine-ref contributions", () => {
      const executor = new RoutineRefStepExecutor();
      const registry = new DisplayContributionRegistry();

      executor.registerDisplayHandler(registry);

      const state = createAccumulatedState();
      registry.apply(state, [
        {
          type: "routine-ref",
          target: "flow-a",
          routine: "build",
          status: "started",
          phase: "routine-ref-start",
          message: "started",
        },
        {
          type: "routine-ref",
          target: "flow-b",
          routine: "review",
          status: "done",
          phase: "routine-ref-done",
          message: "done",
        },
      ]);

      expect(state.routineRefs).toEqual(["flow-a:build", "flow-b:review"]);
    });

    it("initializes routineRefs array when first contribution arrives", () => {
      const executor = new RoutineRefStepExecutor();
      const registry = new DisplayContributionRegistry();
      executor.registerDisplayHandler(registry);

      const state = createAccumulatedState();
      expect(state.routineRefs).toBeUndefined();

      registry.apply(state, [
        {
          type: "routine-ref",
          target: "flow-a",
          routine: "build",
          status: "started",
          phase: "routine-ref-start",
          message: "started",
        },
      ]);

      expect(state.routineRefs).toEqual(["flow-a:build"]);
    });

    it("ignores non-routine-ref contributions", () => {
      const executor = new RoutineRefStepExecutor();
      const registry = new DisplayContributionRegistry();
      executor.registerDisplayHandler(registry);

      const state = createAccumulatedState();
      registry.apply(state, [
        {
          type: "agent",
          agentId: "a1",
          agentStatus: "done",
          phase: "agent-done",
          message: "done",
        },
      ]);

      expect(state.routineRefs).toBeUndefined();
    });
  });
});
