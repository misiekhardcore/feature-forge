// Test-only value imports from cli: self-heal when cli test-utils
// moves to core (S6) (#229).
import { FlowContext } from "@feature-forge/core/src/flows/FlowContext";
import type {
  FlowInstruction,
  LoopInstruction,
} from "@feature-forge/core/src/flows/FlowInstruction";
import { makeMockTypedEventBus } from "@feature-forge/core/src/test-utils";
import { describe, expect, it } from "vitest";

import { LoopStepExecutor } from "./LoopStepExecutor";
import { StepExecutor } from "./StepExecutor";
import { StepExecutorRegistry } from "./StepExecutorRegistry";

// Build a dispatch callback that delegates through a StepExecutorRegistry.
function makeDispatch(
  registry: StepExecutorRegistry,
): (instruction: FlowInstruction, context: FlowContext) => Promise<FlowContext> {
  const dispatch = async (instruction: FlowInstruction, ctx: FlowContext): Promise<FlowContext> => {
    const executor = registry.get(instruction.type);
    if (!executor) {
      throw new Error(`No executor registered for step type "${instruction.type}"`);
    }
    return executor.execute(instruction, ctx, dispatch, makeMockTypedEventBus());
  };
  return dispatch;
}

// ── Helpers ──────────────────────────────────────────────────

class IncrementingExecutor extends StepExecutor {
  readonly type = "inc";

  constructor(private readonly resultPrefix: string) {
    super();
  }

  async execute(instruction: FlowInstruction, context: FlowContext): Promise<FlowContext> {
    const count = context.results.get(`${instruction.id}_count`)?.raw ?? "0";
    const next = parseInt(count) + 1;
    return context
      .withResult(`${instruction.id}_count`, { raw: String(next) })
      .withResult(instruction.id, { raw: `${this.resultPrefix}-round-${next}` });
  }
}

class ParseJsonExecutor extends StepExecutor {
  readonly type = "parsejson";

  async execute(instruction: FlowInstruction, context: FlowContext): Promise<FlowContext> {
    const iteration = context.iteration;
    // Fails on odd iterations, passes on even.
    const passed = iteration >= 2;
    return context.withResult(instruction.id, {
      raw: JSON.stringify({ passed, summary: `iteration ${iteration}` }),
      parsed: {
        passed,
        summary: passed ? "no findings" : `1 critical`,
        details: {
          findings: {
            critical: passed ? [] : [`issue round ${iteration}`],
            warnings: [],
            info: [],
          },
        },
      },
    });
  }
}

// ── Tests ────────────────────────────────────────────────────

describe("LoopStepExecutor while-guard", () => {
  it("runs all iterations when while is absent (regression)", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(() => new IncrementingExecutor("val"));
    const executor = new LoopStepExecutor();

    const instruction: LoopInstruction = {
      type: "loop",
      id: "l",
      maxIterations: 3,
      steps: [{ type: "inc", id: "counter" } as unknown as FlowInstruction],
    };

    const context = new FlowContext({ results: new Map(), prompt: "task" });
    const result = await executor.execute(
      instruction,
      context,
      makeDispatch(registry),
      makeMockTypedEventBus(),
    );

    expect(result.results.get("counter")!.raw).toBe("val-round-3");
    expect(result.results.get("l")!.raw).toContain('"iterations":3');
  });

  it("runs all iterations when while evaluates to true", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(() => new IncrementingExecutor("val"));
    const executor = new LoopStepExecutor();

    const instruction: LoopInstruction = {
      type: "loop",
      id: "l",
      maxIterations: 3,
      while: "true",
      steps: [{ type: "inc", id: "counter" } as unknown as FlowInstruction],
    };

    const context = new FlowContext({ results: new Map(), prompt: "task" });
    const result = await executor.execute(
      instruction,
      context,
      makeDispatch(registry),
      makeMockTypedEventBus(),
    );

    expect(result.results.get("counter")!.raw).toBe("val-round-3");
    expect(result.results.get("l")!.raw).toContain('"iterations":3');
  });

  it("skips the loop entirely when while evaluates to false", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(() => new IncrementingExecutor("val"));
    const executor = new LoopStepExecutor();

    const instruction: LoopInstruction = {
      type: "loop",
      id: "l",
      maxIterations: 3,
      while: "false",
      steps: [{ type: "inc", id: "counter" } as unknown as FlowInstruction],
    };

    const context = new FlowContext({ results: new Map(), prompt: "task" });
    const result = await executor.execute(
      instruction,
      context,
      makeDispatch(registry),
      makeMockTypedEventBus(),
    );

    const loopResult = result.results.get("l")!;
    expect(loopResult.raw).toBe('{"iterations":0,"maxIterations":3,"skipped":true}');
    expect(loopResult.skipped).toBe(true);
    expect(loopResult.parsed!.passed).toBe(true);
    expect(loopResult.parsed!.summary).toBe("Loop skipped by while-guard");
    // Body steps must not have executed.
    expect(result.results.get("counter")).toBeUndefined();
  });

  it("preserves prior results when skipped by the while-guard", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(() => new IncrementingExecutor("val"));
    const executor = new LoopStepExecutor();

    const instruction: LoopInstruction = {
      type: "loop",
      id: "l",
      maxIterations: 3,
      while: "false",
      steps: [{ type: "inc", id: "counter" } as unknown as FlowInstruction],
    };

    const initial = new FlowContext({ results: new Map(), prompt: "task" }).withResult("before", {
      raw: "keep me",
    });
    const result = await executor.execute(
      instruction,
      initial,
      makeDispatch(registry),
      makeMockTypedEventBus(),
    );

    expect(result.results.get("before")!.raw).toBe("keep me");
    expect(result.results.get("l")!.raw).toBe('{"iterations":0,"maxIterations":3,"skipped":true}');
  });

  it("still applies continueWhile after while-guard passes", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(() => new ParseJsonExecutor());
    const executor = new LoopStepExecutor();

    const instruction: LoopInstruction = {
      type: "loop",
      id: "l",
      maxIterations: 5,
      while: "true",
      continueWhile: "results.check?.parsed?.passed",
      accumulateFrom: [],
      steps: [{ type: "parsejson", id: "check" } as unknown as FlowInstruction],
    };

    const context = new FlowContext({ results: new Map(), prompt: "task" });
    const result = await executor.execute(
      instruction,
      context,
      makeDispatch(registry),
      makeMockTypedEventBus(),
    );

    // First iteration fails -> continueWhile false -> stop after 1 round.
    expect(result.results.get("l")!.raw).toContain('"iterations":1');
    expect(result.results.get("check")!.parsed!.passed).toBe(false);
  });

  it("skips when while references a result that is falsy", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(() => new IncrementingExecutor("val"));
    const executor = new LoopStepExecutor();

    const instruction: LoopInstruction = {
      type: "loop",
      id: "l",
      maxIterations: 3,
      while: "results.gate?.parsed?.passed",
      steps: [{ type: "inc", id: "counter" } as unknown as FlowInstruction],
    };

    const initial = new FlowContext({ results: new Map(), prompt: "task" }).withResult("gate", {
      raw: JSON.stringify({ passed: false }),
      parsed: { passed: false, summary: "gate closed" },
    });
    const result = await executor.execute(
      instruction,
      initial,
      makeDispatch(registry),
      makeMockTypedEventBus(),
    );

    expect(result.results.get("l")!.raw).toBe('{"iterations":0,"maxIterations":3,"skipped":true}');
    expect(result.results.get("counter")).toBeUndefined();
  });

  it("runs when while references a result that is truthy", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(() => new IncrementingExecutor("val"));
    const executor = new LoopStepExecutor();

    const instruction: LoopInstruction = {
      type: "loop",
      id: "l",
      maxIterations: 2,
      while: "results.gate?.parsed?.passed",
      steps: [{ type: "inc", id: "counter" } as unknown as FlowInstruction],
    };

    const initial = new FlowContext({ results: new Map(), prompt: "task" }).withResult("gate", {
      raw: JSON.stringify({ passed: true }),
      parsed: { passed: true, summary: "gate open" },
    });
    const result = await executor.execute(
      instruction,
      initial,
      makeDispatch(registry),
      makeMockTypedEventBus(),
    );

    expect(result.results.get("counter")!.raw).toBe("val-round-2");
    expect(result.results.get("l")!.raw).toContain('"iterations":2');
  });
});
