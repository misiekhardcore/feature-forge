import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";

import { makeMockEventBus } from "../../test-utils";
import { FlowContext } from "../FlowContext";
import {
  type FlowInstruction,
  type ParallelInstruction,
  ParallelInstructionSchema,
} from "../FlowInstruction";
import { StepExecutor } from "../StepExecutor";
import { StepExecutorRegistry } from "../StepExecutorRegistry";
import { ParallelStepExecutor } from "./ParallelStepExecutor";

// Build a dispatch callback that delegates through a StepExecutorRegistry.
function makeDispatch(
  registry: StepExecutorRegistry,
): (instruction: FlowInstruction, context: FlowContext) => Promise<FlowContext> {
  const dispatch = async (instruction: FlowInstruction, ctx: FlowContext): Promise<FlowContext> => {
    const executor = registry.get(instruction.type);
    if (!executor) {
      throw new Error(`No executor registered for step type "${instruction.type}"`);
    }
    return executor.execute(instruction, ctx, dispatch, makeMockEventBus());
  };
  return dispatch;
}

// ── Test helpers ─────────────────────────────────────────────

class SuccessExecutor extends StepExecutor {
  readonly type: string;

  constructor(
    type: string,
    private readonly output: string,
  ) {
    super();
    this.type = type;
  }

  async execute(instruction: FlowInstruction, context: FlowContext): Promise<FlowContext> {
    return context.withResult(instruction.id, { raw: this.output });
  }
}

class FailingExecutor extends StepExecutor {
  readonly type = "failing";

  async execute(instruction: FlowInstruction, _context: FlowContext): Promise<FlowContext> {
    throw new Error(`step ${instruction.id} failed`);
  }
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

  // ── fail_fast ──────────────────────────────────

  describe("fail_fast", () => {
    it("omitted failureMode succeeds with all children", async () => {
      const registry = new StepExecutorRegistry();
      registry.register(() => new SuccessExecutor("op-a", "child-a-out"));
      registry.register(() => new SuccessExecutor("op-b", "child-b-out"));

      const instruction: ParallelInstruction = {
        type: "parallel",
        id: "block",
        steps: [
          { type: "op-a", id: "op-a" } as unknown as FlowInstruction,
          { type: "op-b", id: "op-b" } as unknown as FlowInstruction,
        ],
      };

      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const eventBus = makeMockEventBus();

      const result = await executor.execute(instruction, context, makeDispatch(registry), eventBus);

      expect(result.results.get("op-a")!.raw).toBe("child-a-out");
      expect(result.results.get("op-b")!.raw).toBe("child-b-out");
      expect(result.results.get("block")!.parsed!.passed).toBe(true);
    });

    it("throws on first rejection (explicit fail_fast)", async () => {
      const registry = new StepExecutorRegistry();
      registry.register(() => new SuccessExecutor("op-a", "child-a-out"));
      registry.register(() => new FailingExecutor());

      const instruction: ParallelInstruction = {
        type: "parallel",
        id: "block",
        failureMode: "fail_fast",
        steps: [
          { type: "op-a", id: "op-a" } as unknown as FlowInstruction,
          { type: "failing", id: "b" } as unknown as FlowInstruction,
        ],
      };

      const context = new FlowContext({ results: new Map(), prompt: "task" });

      await expect(
        executor.execute(instruction, context, makeDispatch(registry), makeMockEventBus()),
      ).rejects.toThrow("step b failed");
    });
  });

  // ── continue_on_error ────────────────────────────────────

  describe("continue_on_error", () => {
    it("partial failure: no throw, passed=true, successes merged, failures in raw", async () => {
      const registry = new StepExecutorRegistry();
      registry.register(() => new SuccessExecutor("op-a", "child-a-out"));
      registry.register(() => new FailingExecutor());

      const instruction: ParallelInstruction = {
        type: "parallel",
        id: "block",
        failureMode: "continue_on_error",
        steps: [
          { type: "op-a", id: "op-a" } as unknown as FlowInstruction,
          { type: "failing", id: "b" } as unknown as FlowInstruction,
        ],
      };

      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const eventBus = makeMockEventBus();

      const result = await executor.execute(instruction, context, makeDispatch(registry), eventBus);

      expect(result.results.get("op-a")!.raw).toBe("child-a-out");
      expect(result.results.has("b")).toBe(false);

      const blockResult = result.results.get("block")!;
      expect(blockResult.parsed?.kind).toBe("build");
      expect(blockResult.parsed?.passed).toBe(true);

      const parsedRaw = JSON.parse(blockResult.raw);
      expect(parsedRaw.failures).toBeDefined();
      expect(parsedRaw.failures.b).toBe("step b failed");

      expect(eventBus.emit).toHaveBeenCalledWith(
        "feature-forge:parallel-done",
        expect.objectContaining({
          phase: "parallel-done",
        }),
      );
    });

    it("all fail: no throw, passed=false", async () => {
      const registry = new StepExecutorRegistry();
      registry.register(() => new FailingExecutor());

      const instruction: ParallelInstruction = {
        type: "parallel",
        id: "block",
        failureMode: "continue_on_error",
        steps: [
          { type: "failing", id: "a" } as unknown as FlowInstruction,
          { type: "failing", id: "b" } as unknown as FlowInstruction,
        ],
      };

      const context = new FlowContext({ results: new Map(), prompt: "task" });

      const result = await executor.execute(
        instruction,
        context,
        makeDispatch(registry),
        makeMockEventBus(),
      );

      const blockResult = result.results.get("block")!;
      expect(blockResult.parsed?.passed).toBe(false);
    });
  });

  // ── all_or_nothing ────────────────────────────────────────

  describe("all_or_nothing", () => {
    it("partial failure: no throw, passed=false, successes merged, failures in raw", async () => {
      const registry = new StepExecutorRegistry();
      registry.register(() => new SuccessExecutor("op-a", "child-a-out"));
      registry.register(() => new FailingExecutor());

      const instruction: ParallelInstruction = {
        type: "parallel",
        id: "block",
        failureMode: "all_or_nothing",
        steps: [
          { type: "op-a", id: "op-a" } as unknown as FlowInstruction,
          { type: "failing", id: "b" } as unknown as FlowInstruction,
        ],
      };

      const context = new FlowContext({ results: new Map(), prompt: "task" });

      const result = await executor.execute(
        instruction,
        context,
        makeDispatch(registry),
        makeMockEventBus(),
      );

      expect(result.results.get("op-a")!.raw).toBe("child-a-out");

      const blockResult = result.results.get("block")!;
      expect(blockResult.parsed?.passed).toBe(false);

      const parsedRaw = JSON.parse(blockResult.raw);
      expect(parsedRaw.failures.b).toBe("step b failed");
    });
  });
});
