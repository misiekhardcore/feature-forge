import { describe, expect, it, vi } from "vitest";

import type { FlowDefinition, FlowInstruction } from "./FlowInstruction";
import { RoutineExecutor } from "./RoutineExecutor";
import type { RoutineResult } from "./RoutineResult";
import { RoutineTool } from "./RoutineTool";

function makeFlow(routineName = "run_test"): FlowDefinition {
  return {
    name: "test-flow",
    command: "/test",
    orchestrator: { prompt: "orchestrator.md" },
    routines: {
      [routineName]: {
        params: [
          { name: "task", description: "Task description" },
          { name: "plan", description: "Implementation plan" },
        ],
        steps: [
          {
            type: "agent",
            id: "a1",
            spec: "build",
            task: "{{task}}",
          } as unknown as FlowInstruction,
        ],
      },
    },
  } as FlowDefinition;
}

describe("RoutineTool", () => {
  describe("constructor", () => {
    it("sets name, label, description, and parameters from the routine definition", () => {
      const flow = makeFlow();
      const executor = new RoutineExecutor(flow, {
        find: vi.fn(),
      } as unknown as RoutineExecutor["stepExecutorRegistry"]);

      const tool = new RoutineTool("run_test", flow, executor);

      expect(tool.name).toBe("run_test");
      expect(tool.label).toBe("Run Test");
      expect(tool.description).toContain("run_test");
      expect(tool.description).toContain("task, plan");
      expect(tool.parameters).toBeDefined();
    });

    it("converts underscores to spaces and capitalises for the label", () => {
      const flow = makeFlow("run_build_loop");
      const executor = new RoutineExecutor(flow, {
        find: vi.fn(),
      } as unknown as RoutineExecutor["stepExecutorRegistry"]);

      const tool = new RoutineTool("run_build_loop", flow, executor);

      expect(tool.label).toBe("Run Build Loop");
    });
  });

  describe("execute", () => {
    it("calls routineExecutor.run and returns the result as JSON", async () => {
      const flow = makeFlow();
      const expectedResult: RoutineResult = {
        routine: "run_test",
        passed: true,
        results: { a1: { raw: "done" } },
        summary: "all good",
      };

      const mockExecutor = {
        run: vi.fn().mockResolvedValue(expectedResult),
      } as unknown as RoutineExecutor;

      const tool = new RoutineTool("run_test", flow, mockExecutor);

      const result = await tool.execute(
        "call-1",
        { task: "test task", plan: "test plan" },
        undefined,
        undefined,
        {} as unknown as Parameters<RoutineTool["execute"]>[4],
      );

      expect(mockExecutor.run).toHaveBeenCalledWith("run_test", {
        task: "test task",
        plan: "test plan",
      });
      expect(result.content).toHaveLength(1);
      const textContent = result.content[0];
      expect(textContent?.type).toBe("text");
      expect("text" in textContent! && textContent.text).toContain("all good");
    });
  });
});
