import { describe, expect, it, vi } from "vitest";

import { makeMockTypedEventBus } from "../../test-utils";
import { FlowContext } from "../FlowContext";
import type { RoutineRefInstruction } from "../FlowInstruction";
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
});
