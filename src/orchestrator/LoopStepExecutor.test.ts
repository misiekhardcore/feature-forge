import { describe, expect, it, vi } from "vitest";

import { FlowContext, type InstructionResult, type ParsedResult } from "./FlowContext";
import type { FlowInstruction, LoopInstruction } from "./FlowInstruction";
import { LoopStepExecutor } from "./LoopStepExecutor";

function makeLoopInstruction(overrides: Partial<LoopInstruction> = {}): LoopInstruction {
  return {
    type: "loop",
    id: "build_loop",
    maxIterations: 3,
    continueWhile: "!results.builder?.parsed?.passed",
    accumulateFrom: ["builder"],
    steps: [
      {
        type: "agent",
        id: "builder",
        spec: "build",
        task: "do build",
        parseJson: true,
      } as unknown as FlowInstruction,
    ],
    ...overrides,
  } as unknown as LoopInstruction;
}

describe("LoopStepExecutor", () => {
  const executor = new LoopStepExecutor();

  describe("type", () => {
    it("returns 'loop'", () => {
      expect(executor.type).toBe("loop");
    });
  });

  describe("execute", () => {
    it("runs the loop body once when no continueWhile is set", async () => {
      const instruction = makeLoopInstruction({ continueWhile: undefined });

      let bodyRuns = 0;
      const executeStep = vi
        .fn()
        .mockImplementation(async (_: FlowInstruction, ctx: FlowContext) => {
          bodyRuns++;
          return ctx;
        });

      const context = new FlowContext(new Map(), "task", "");
      await executor.execute(instruction, context, executeStep);

      expect(bodyRuns).toBe(1);
    });

    it("repeats until continueWhile evaluates to false", async () => {
      const instruction = makeLoopInstruction({
        maxIterations: 5,
        continueWhile: "!results.builder?.parsed?.passed",
      });

      let runCount = 0;
      const executeStep = vi
        .fn()
        .mockImplementation(async (_: FlowInstruction, ctx: FlowContext) => {
          runCount++;
          const parsed: ParsedResult =
            runCount >= 3
              ? { kind: "build", passed: true, summary: `ok run ${runCount}` }
              : { kind: "build", passed: false, summary: `fail run ${runCount}` };
          const result: InstructionResult = { raw: `run ${runCount}`, parsed };
          return ctx.withResult("builder", result);
        });

      const context = new FlowContext(new Map(), "task", "");
      const result = await executor.execute(instruction, context, executeStep);

      expect(runCount).toBe(3);
      const builderResult = result.results.get("builder");
      expect(builderResult!.parsed).toEqual({
        kind: "build",
        passed: true,
        summary: "ok run 3",
      });
    });

    it("stops at maxIterations even if continueWhile is still true", async () => {
      const instruction = makeLoopInstruction({
        maxIterations: 2,
        continueWhile: "!results.builder?.parsed?.passed",
      });

      let runCount = 0;
      const executeStep = vi
        .fn()
        .mockImplementation(async (_: FlowInstruction, ctx: FlowContext) => {
          runCount++;
          const result: InstructionResult = {
            raw: `run ${runCount}`,
            parsed: { kind: "build", passed: false, summary: `fail ${runCount}` },
          };
          return ctx.withResult("builder", result);
        });

      const context = new FlowContext(new Map(), "task", "");
      await executor.execute(instruction, context, executeStep);

      expect(runCount).toBe(2);
    });

    it("clears results between iterations", async () => {
      const instruction = makeLoopInstruction({
        maxIterations: 2,
        // After first iteration where builder passed, loop should stop.
        continueWhile: "!results.builder?.parsed?.passed",
      });

      let runCount = 0;
      const executeStep = vi
        .fn()
        .mockImplementation(async (_: FlowInstruction, ctx: FlowContext) => {
          runCount++;
          // First iteration: builder NOT present (results cleared) → continueWhile should resolve
          // Since there's no "builder" result at start, the expression !results.builder?.parsed?.passed
          // with optional chaining → results.builder is undefined → ?.parsed is undefined → !undefined = true → continue
          if (runCount === 1) {
            // After executeStep returns, the result IS stored. Then continueWhile evaluates.
            // At that point builder IS present since executeStep just stored it.
            // So: first run: builder passed true → !true = false → stop after 1 run
            const result: InstructionResult = {
              raw: `run ${runCount}`,
              parsed: { kind: "build", passed: true, summary: "ok" },
            };
            return ctx.withResult("builder", result);
          }
          return ctx;
        });

      const context = new FlowContext(new Map(), "task", "");
      await executor.execute(instruction, context, executeStep);

      // After first iteration, builder passed → !true = false → stop.
      expect(runCount).toBe(1);
    });

    it("accumulates feedback from accumulateFrom result ids", async () => {
      const instruction = makeLoopInstruction({
        maxIterations: 2,
        continueWhile: "!results.builder?.parsed?.passed",
        accumulateFrom: ["builder"],
        steps: [
          {
            type: "agent",
            id: "builder",
            spec: "build",
            task: "do build",
            parseJson: true,
          } as unknown as FlowInstruction,
        ],
      });

      let runCount = 0;
      const executeStep = vi
        .fn()
        .mockImplementation(async (_: FlowInstruction, ctx: FlowContext) => {
          runCount++;
          const result: InstructionResult = {
            raw: `run ${runCount}`,
            parsed:
              runCount === 1
                ? { kind: "build", passed: false, summary: "failed first" }
                : { kind: "build", passed: true, summary: "ok" },
          };
          return ctx.withResult("builder", result);
        });

      const context = new FlowContext(new Map(), "task", "");
      await executor.execute(instruction, context, executeStep);

      expect(runCount).toBe(2);
    });

    it("tracks iteration counter in context", async () => {
      const instruction = makeLoopInstruction({
        maxIterations: 2,
        continueWhile: "!results.builder?.parsed?.passed",
      });

      const iterations: number[] = [];
      const executeStep = vi
        .fn()
        .mockImplementation(async (_: FlowInstruction, ctx: FlowContext) => {
          iterations.push(ctx.iteration);
          const result: InstructionResult = {
            raw: `iteration ${ctx.iteration}`,
            parsed: { kind: "build", passed: ctx.iteration >= 1, summary: "ok" },
          };
          return ctx.withResult("builder", result);
        });

      const context = new FlowContext(new Map(), "task", "");
      await executor.execute(instruction, context, executeStep);

      // First iter: 0, check continueWhile → true → second iter: 1, check → !true = false → stop
      expect(iterations).toEqual([0, 1]);
    });
  });
});
