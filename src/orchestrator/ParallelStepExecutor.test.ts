import { describe, expect, it, vi } from "vitest";

import { FlowContext, type InstructionResult } from "./FlowContext";
import type { FlowInstruction } from "./FlowInstruction";
import { ParallelStepExecutor } from "./ParallelStepExecutor";

describe("ParallelStepExecutor", () => {
  const executor = new ParallelStepExecutor();

  describe("type", () => {
    it("returns 'parallel'", () => {
      expect(executor.type).toBe("parallel");
    });
  });

  describe("execute", () => {
    it("runs all child steps concurrently and merges results", async () => {
      const instruction: FlowInstruction = {
        type: "parallel",
        id: "inspect",
        steps: [
          { type: "agent", id: "a", spec: "build", task: "task a" } as unknown as FlowInstruction,
          { type: "agent", id: "b", spec: "build", task: "task b" } as unknown as FlowInstruction,
        ],
      } as unknown as FlowInstruction;

      const context = new FlowContext(new Map(), "task", "");

      const spy = vi.fn();
      async function executeStep(instr: FlowInstruction, ctx: FlowContext): Promise<FlowContext> {
        spy(instr.id);
        const result: InstructionResult = { raw: `result for ${instr.id}` };
        return ctx.withResult(instr.id, result);
      }

      const result = await executor.execute(instruction, context, executeStep);

      expect(spy).toHaveBeenCalledTimes(2);
      expect(result.results.size).toBe(2);
      expect(result.results.get("a")!.raw).toBe("result for a");
      expect(result.results.get("b")!.raw).toBe("result for b");
    });

    it("does not merge duplicate results from branches", async () => {
      const instruction: FlowInstruction = {
        type: "parallel",
        id: "inspect",
        steps: [
          {
            type: "agent",
            id: "shared",
            spec: "build",
            task: "shared",
          } as unknown as FlowInstruction,
          {
            type: "agent",
            id: "shared",
            spec: "build",
            task: "also shared",
          } as unknown as FlowInstruction,
        ],
      } as unknown as FlowInstruction;

      const context = new FlowContext(new Map(), "task", "");

      async function executeStep(instr: FlowInstruction, ctx: FlowContext): Promise<FlowContext> {
        const result: InstructionResult = { raw: `result for ${instr.id}` };
        return ctx.withResult(instr.id, result);
      }

      const result = await executor.execute(instruction, context, executeStep);

      // Only one result stored — merge deduplicates by id
      expect(result.results.size).toBe(1);
      expect(result.results.has("shared")).toBe(true);
    });

    it("passes the same starting context to all branches", async () => {
      const instruction: FlowInstruction = {
        type: "parallel",
        id: "inspect",
        steps: [
          { type: "agent", id: "a", spec: "build", task: "task a" } as unknown as FlowInstruction,
          { type: "agent", id: "b", spec: "build", task: "task b" } as unknown as FlowInstruction,
        ],
      } as unknown as FlowInstruction;

      const context = new FlowContext(new Map(), "shared-task", "shared-plan");
      const capturedContexts: FlowContext[] = [];

      async function executeStep(_instr: FlowInstruction, ctx: FlowContext): Promise<FlowContext> {
        capturedContexts.push(ctx);
        return ctx;
      }

      await executor.execute(instruction, context, executeStep);

      expect(capturedContexts).toHaveLength(2);
      for (const captured of capturedContexts) {
        expect(captured.task).toBe("shared-task");
        expect(captured.plan).toBe("shared-plan");
      }
    });
  });
});
