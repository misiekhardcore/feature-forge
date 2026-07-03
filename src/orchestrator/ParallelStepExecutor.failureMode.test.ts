import { Value } from "typebox/value";
import { describe, expect, it, vi } from "vitest";

import { FlowContext, type InstructionResult } from "./FlowContext";
import {
  type FlowInstruction,
  type ParallelInstruction,
  ParallelInstructionSchema,
} from "./FlowInstruction";
import { ParallelStepExecutor } from "./ParallelStepExecutor";

// ── Helpers ──────────────────────────────────────────────────

function makeExecutionSpy() {
  const spy = vi.fn();
  async function executeStep(instr: FlowInstruction, ctx: FlowContext): Promise<FlowContext> {
    spy(instr.id);
    const result: InstructionResult = { raw: `result for ${instr.id}` };
    return ctx.withResult(instr.id, result);
  }
  return { spy, executeStep };
}

function makeMixedSteps(
  failingIds: Set<string>,
  errorMessage: string = "step failed",
): (instr: FlowInstruction, ctx: FlowContext) => Promise<FlowContext> {
  const spy = vi.fn();
  async function executeStep(instr: FlowInstruction, ctx: FlowContext): Promise<FlowContext> {
    spy(instr.id);
    if (failingIds.has(instr.id)) {
      throw new Error(errorMessage);
    }
    const result: InstructionResult = { raw: `result for ${instr.id}` };
    return ctx.withResult(instr.id, result);
  }
  return executeStep;
}

// ── Schema tests ────────────────────────────────────────────

describe("ParallelInstructionSchema — failureMode", () => {
  it("accepts a parallel instruction without failureMode (default)", () => {
    const valid = { type: "parallel", id: "p1", steps: [] };
    expect(Value.Check(ParallelInstructionSchema, valid)).toBe(true);
  });

  it("accepts fail_fast explicitly", () => {
    const valid = { type: "parallel", id: "p1", steps: [], failureMode: "fail_fast" };
    expect(Value.Check(ParallelInstructionSchema, valid)).toBe(true);
  });

  it("accepts continue_on_error", () => {
    const valid = { type: "parallel", id: "p1", steps: [], failureMode: "continue_on_error" };
    expect(Value.Check(ParallelInstructionSchema, valid)).toBe(true);
  });

  it("accepts all_or_nothing", () => {
    const valid = { type: "parallel", id: "p1", steps: [], failureMode: "all_or_nothing" };
    expect(Value.Check(ParallelInstructionSchema, valid)).toBe(true);
  });

  it("rejects an unknown failureMode literal", () => {
    const invalid = { type: "parallel", id: "p1", steps: [], failureMode: "retry_once" };
    expect(Value.Check(ParallelInstructionSchema, invalid)).toBe(false);
  });

  it("rejects empty string as failureMode", () => {
    const invalid = { type: "parallel", id: "p1", steps: [], failureMode: "" };
    expect(Value.Check(ParallelInstructionSchema, invalid)).toBe(false);
  });
});

// ── Executor tests ──────────────────────────────────────────

describe("ParallelStepExecutor — failureMode", () => {
  const executor = new ParallelStepExecutor();

  // ── fail_fast (default) ──────────────────────────────────

  describe("fail_fast (default)", () => {
    it("runs all children when none fail", async () => {
      const instruction: ParallelInstruction = {
        type: "parallel",
        id: "inspect",
        failureMode: "fail_fast",
        steps: [
          { type: "agent", id: "a", spec: "build", task: "task a" } as unknown as FlowInstruction,
          { type: "agent", id: "b", spec: "build", task: "task b" } as unknown as FlowInstruction,
        ],
      } as unknown as ParallelInstruction;

      const context = new FlowContext(new Map(), "task", "");
      const { spy, executeStep } = makeExecutionSpy();

      const result = await executor.execute(instruction, context, executeStep);

      expect(spy).toHaveBeenCalledTimes(2);
      expect(result.results.size).toBe(2);
    });

    it("omitted failureMode behaves like fail_fast", async () => {
      const instruction: ParallelInstruction = {
        type: "parallel",
        id: "inspect",
        // no failureMode — defaults to fail_fast
        steps: [
          { type: "agent", id: "a", spec: "build", task: "task a" } as unknown as FlowInstruction,
          { type: "agent", id: "b", spec: "build", task: "task b" } as unknown as FlowInstruction,
        ],
      } as unknown as ParallelInstruction;

      const context = new FlowContext(new Map(), "task", "");
      const { spy, executeStep } = makeExecutionSpy();

      const result = await executor.execute(instruction, context, executeStep);

      expect(spy).toHaveBeenCalledTimes(2);
      expect(result.results.size).toBe(2);
    });

    it("throws on first rejection with fail_fast (explicit)", async () => {
      const instruction: ParallelInstruction = {
        type: "parallel",
        id: "inspect",
        failureMode: "fail_fast",
        steps: [
          { type: "agent", id: "a", spec: "build", task: "task a" } as unknown as FlowInstruction,
          { type: "agent", id: "b", spec: "build", task: "task b" } as unknown as FlowInstruction,
        ],
      } as unknown as ParallelInstruction;

      const context = new FlowContext(new Map(), "task", "");
      const failingFn = async (instr: FlowInstruction, ctx: FlowContext) => {
        if (instr.id === "a") throw new Error("boom from a");
        return ctx.withResult(instr.id, { raw: "ok" });
      };

      await expect(executor.execute(instruction, context, failingFn)).rejects.toThrow(
        "boom from a",
      );
    });

    it("throws on first rejection when failureMode omitted (default fail_fast)", async () => {
      const instruction: ParallelInstruction = {
        type: "parallel",
        id: "inspect",
        // no failureMode
        steps: [
          { type: "agent", id: "a", spec: "build", task: "task a" } as unknown as FlowInstruction,
          { type: "agent", id: "b", spec: "build", task: "task b" } as unknown as FlowInstruction,
        ],
      } as unknown as ParallelInstruction;

      const context = new FlowContext(new Map(), "task", "");
      const failingFn = async (instr: FlowInstruction, ctx: FlowContext) => {
        if (instr.id === "a") throw new Error("boom");
        return ctx.withResult(instr.id, { raw: "ok" });
      };

      await expect(executor.execute(instruction, context, failingFn)).rejects.toThrow("boom");
    });
  });

  // ── continue_on_error ────────────────────────────────────

  describe("continue_on_error", () => {
    it("partial failure: no throw, passed=true, successes merged, failures in raw", async () => {
      const instruction: ParallelInstruction = {
        type: "parallel",
        id: "inspect",
        failureMode: "continue_on_error",
        steps: [
          { type: "agent", id: "a", spec: "build", task: "task a" } as unknown as FlowInstruction,
          { type: "agent", id: "b", spec: "build", task: "task b" } as unknown as FlowInstruction,
        ],
      } as unknown as ParallelInstruction;

      const context = new FlowContext(new Map(), "task", "");
      const executeStep = makeMixedSteps(new Set(["a"]), "step a failed");

      const result = await executor.execute(instruction, context, executeStep);

      // No throw — reached this point.

      // Success result merged.
      expect(result.results.has("b")).toBe(true);
      expect(result.results.get("b")!.raw).toBe("result for b");

      // Failed result NOT merged.
      expect(result.results.has("a")).toBe(false);

      // Block-level result present.
      expect(result.results.has("inspect")).toBe(true);
      const blockResult = result.results.get("inspect")!;
      expect(blockResult.parsed?.kind).toBe("build");
      expect(blockResult.parsed?.passed).toBe(true);

      // Failures recorded in raw.
      const parsedRaw = JSON.parse(blockResult.raw);
      expect(parsedRaw.failures).toBeDefined();
      expect(parsedRaw.failures.a).toBe("step a failed");
    });

    it("all fail: no throw, passed=false", async () => {
      const instruction: ParallelInstruction = {
        type: "parallel",
        id: "inspect",
        failureMode: "continue_on_error",
        steps: [
          { type: "agent", id: "a", spec: "build", task: "task a" } as unknown as FlowInstruction,
          { type: "agent", id: "b", spec: "build", task: "task b" } as unknown as FlowInstruction,
        ],
      } as unknown as ParallelInstruction;

      const context = new FlowContext(new Map(), "task", "");
      const executeStep = makeMixedSteps(new Set(["a", "b"]), "all failed");

      const result = await executor.execute(instruction, context, executeStep);

      // Block-level result has passed=false.
      expect(result.results.has("inspect")).toBe(true);
      const blockResult = result.results.get("inspect")!;
      expect(blockResult.parsed?.passed).toBe(false);
      expect(blockResult.parsed?.kind).toBe("build");
    });

    it("all succeed: no block result needed, still produces one for consistency", async () => {
      const instruction: ParallelInstruction = {
        type: "parallel",
        id: "inspect",
        failureMode: "continue_on_error",
        steps: [
          { type: "agent", id: "a", spec: "build", task: "task a" } as unknown as FlowInstruction,
          { type: "agent", id: "b", spec: "build", task: "task b" } as unknown as FlowInstruction,
        ],
      } as unknown as ParallelInstruction;

      const context = new FlowContext(new Map(), "task", "");
      const { spy, executeStep } = makeExecutionSpy();

      const result = await executor.execute(instruction, context, executeStep);

      expect(spy).toHaveBeenCalledTimes(2);
      // Children results merged.
      expect(result.results.has("a")).toBe(true);
      expect(result.results.has("b")).toBe(true);
      // continue_on_error always produces block result when failures exist,
      // but when all succeed we also produce a block result (per design: block
      // result is produced whenever we enter the non-fail_fast path and it
      // is NOT the all_or_nothing all-success shortcut).
      expect(result.results.has("inspect")).toBe(true);
      const blockResult = result.results.get("inspect")!;
      expect(blockResult.parsed?.passed).toBe(true);
    });
  });

  // ── all_or_nothing ────────────────────────────────────────

  describe("all_or_nothing", () => {
    it("all succeed: identical to today's success path (no block result)", async () => {
      const instruction: ParallelInstruction = {
        type: "parallel",
        id: "inspect",
        failureMode: "all_or_nothing",
        steps: [
          { type: "agent", id: "a", spec: "build", task: "task a" } as unknown as FlowInstruction,
          { type: "agent", id: "b", spec: "build", task: "task b" } as unknown as FlowInstruction,
        ],
      } as unknown as ParallelInstruction;

      const context = new FlowContext(new Map(), "task", "");
      const { spy, executeStep } = makeExecutionSpy();

      const result = await executor.execute(instruction, context, executeStep);

      // Children merged — same as fail_fast success path.
      expect(spy).toHaveBeenCalledTimes(2);
      expect(result.results.has("a")).toBe(true);
      expect(result.results.has("b")).toBe(true);

      // No block-level result (identical to today).
      expect(result.results.has("inspect")).toBe(false);
    });

    it("partial failure: no throw, passed=false, successes merged, failures in raw", async () => {
      const instruction: ParallelInstruction = {
        type: "parallel",
        id: "inspect",
        failureMode: "all_or_nothing",
        steps: [
          { type: "agent", id: "a", spec: "build", task: "task a" } as unknown as FlowInstruction,
          { type: "agent", id: "b", spec: "build", task: "task b" } as unknown as FlowInstruction,
        ],
      } as unknown as ParallelInstruction;

      const context = new FlowContext(new Map(), "task", "");
      const executeStep = makeMixedSteps(new Set(["a"]), "step a failed");

      const result = await executor.execute(instruction, context, executeStep);

      // Success result merged.
      expect(result.results.has("b")).toBe(true);

      // Failed result NOT merged.
      expect(result.results.has("a")).toBe(false);

      // Block-level result with passed=false.
      expect(result.results.has("inspect")).toBe(true);
      const blockResult = result.results.get("inspect")!;
      expect(blockResult.parsed?.kind).toBe("build");
      expect(blockResult.parsed?.passed).toBe(false);

      // Failures recorded in raw.
      const parsedRaw = JSON.parse(blockResult.raw);
      expect(parsedRaw.failures.a).toBe("step a failed");
    });

    it("duplicate ids across branches: only first success merged", async () => {
      const instruction: ParallelInstruction = {
        type: "parallel",
        id: "inspect",
        failureMode: "all_or_nothing",
        steps: [
          {
            type: "agent",
            id: "shared",
            spec: "build",
            task: "shared a",
          } as unknown as FlowInstruction,
          {
            type: "agent",
            id: "shared",
            spec: "build",
            task: "shared b",
          } as unknown as FlowInstruction,
        ],
      } as unknown as ParallelInstruction;

      const context = new FlowContext(new Map(), "task", "");

      let callCount = 0;
      async function executeStep(instr: FlowInstruction, ctx: FlowContext): Promise<FlowContext> {
        callCount++;
        return ctx.withResult(instr.id, { raw: `result-${callCount}` });
      }

      const result = await executor.execute(instruction, context, executeStep);

      // All succeed → identical to today: no block result, only first result kept.
      expect(result.results.has("inspect")).toBe(false);
      expect(result.results.has("shared")).toBe(true);
      expect(result.results.get("shared")!.raw).toBe("result-1");
    });
  });
});
