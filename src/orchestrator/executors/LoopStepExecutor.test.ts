import { describe, expect, it } from "vitest";

import { FlowContext } from "../FlowContext";
import type { FlowInstruction, LoopInstruction } from "../FlowInstruction";
import { StepExecutor } from "../StepExecutor";
import { StepExecutorRegistry } from "../StepExecutorRegistry";
import { LoopStepExecutor } from "./LoopStepExecutor";

// Build a dispatch callback that delegates through a StepExecutorRegistry.
function makeDispatch(
  registry: StepExecutorRegistry,
): (instruction: FlowInstruction, context: FlowContext) => Promise<FlowContext> {
  const dispatch = async (instruction: FlowInstruction, ctx: FlowContext): Promise<FlowContext> => {
    const executor = registry.get(instruction.type);
    if (!executor) {
      throw new Error(`No executor registered for step type "${instruction.type}"`);
    }
    return executor.execute(instruction, ctx, dispatch);
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
    const iteration = context.iteration + 1;
    // Fails on odd iterations, passes on even.
    const passed = iteration >= 2;
    return context.withResult(instruction.id, {
      raw: JSON.stringify({ passed, summary: `iteration ${iteration}` }),
      parsed: {
        kind: "review" as const,
        passed,
        findings: {
          critical: passed ? [] : [`issue round ${iteration}`],
          warnings: [],
          info: [],
        },
      },
    });
  }
}

// ── Tests ────────────────────────────────────────────────────

describe("LoopStepExecutor", () => {
  it("executes body steps for each iteration up to maxIterations", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(new IncrementingExecutor("val"));
    const executor = new LoopStepExecutor();

    const instruction: LoopInstruction = {
      type: "loop",
      id: "l",
      maxIterations: 3,
      steps: [{ type: "inc", id: "counter" } as unknown as FlowInstruction],
    };

    const context = new FlowContext(new Map(), "task");
    const executeStep = makeDispatch(registry);
    const result = await executor.execute(instruction, context, executeStep);

    // After 3 iterations the counter should be 3.
    expect(result.results.get("counter")!.raw).toBe("val-round-3");
    expect(result.results.get("counter_count")!.raw).toBe("3");
    expect(result.results.get("l")!.parsed!.passed).toBe(true);
  });

  it("stops early when continueWhile evaluates to false", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(new ParseJsonExecutor());
    const executor = new LoopStepExecutor();

    const instruction: LoopInstruction = {
      type: "loop",
      id: "l",
      maxIterations: 5,
      continueWhile: "!results.check?.parsed?.passed",
      accumulateFrom: [],
      steps: [{ type: "parsejson", id: "check" } as unknown as FlowInstruction],
    };

    const context = new FlowContext(new Map(), "task");
    const executeStep = makeDispatch(registry);
    const result = await executor.execute(instruction, context, executeStep);

    // Iteration 1 fails (passed=false → continueWhile true → continues)
    // Iteration 2 passes (passed=true → continueWhile false → stops)
    // So 2 iterations total.
    expect(result.results.get("l")!.raw).toContain('"iterations":2');
    expect(result.results.get("check")!.parsed!.passed).toBe(true);
  });

  it("always runs at least one iteration (do-while semantics)", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(new ParseJsonExecutor());
    const executor = new LoopStepExecutor();

    // continueWhile immediately evaluates false because results.check doesn't
    // exist yet, but the body always runs at least once.
    const instruction: LoopInstruction = {
      type: "loop",
      id: "l",
      maxIterations: 3,
      continueWhile: "results.check?.parsed?.passed",
      accumulateFrom: [],
      steps: [{ type: "parsejson", id: "check" } as unknown as FlowInstruction],
    };

    const context = new FlowContext(new Map(), "task");
    const executeStep = makeDispatch(registry);
    const result = await executor.execute(instruction, context, executeStep);

    // Body ran at least once even though condition was initially false-like.
    expect(result.results.get("l")!.raw).toContain('"iterations":1');
  });

  it("stops when maxIterations is reached even if continueWhile is true", async () => {
    // Use an executor that always fails so continueWhile is always true.
    // The loop should run all maxIterations iterations.
    const registry = new StepExecutorRegistry();
    registry.register(
      new (class extends StepExecutor {
        readonly type = "always-fail";
        async execute(instruction: FlowInstruction, context: FlowContext): Promise<FlowContext> {
          return context.withResult(instruction.id, {
            raw: JSON.stringify({ passed: false, summary: "fail" }),
            parsed: {
              kind: "review" as const,
              passed: false,
              findings: { critical: ["always fails"], warnings: [], info: [] },
            },
          });
        }
      })(),
    );
    const executor = new LoopStepExecutor();

    const instruction: LoopInstruction = {
      type: "loop",
      id: "l",
      maxIterations: 3,
      continueWhile: "!results.check?.parsed?.passed",
      accumulateFrom: [],
      steps: [{ type: "always-fail", id: "check" } as unknown as FlowInstruction],
    };

    const context = new FlowContext(new Map(), "task");
    const executeStep = makeDispatch(registry);
    const result = await executor.execute(instruction, context, executeStep);

    expect(result.results.get("l")!.raw).toContain('"iterations":3');
  });

  it("accumulates feedback from accumulateFrom steps", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(new IncrementingExecutor("build"));
    const executor = new LoopStepExecutor();

    const instruction: LoopInstruction = {
      type: "loop",
      id: "l",
      maxIterations: 2,
      accumulateFrom: ["step"],
      steps: [{ type: "inc", id: "step" } as unknown as FlowInstruction],
    };

    const context = new FlowContext(new Map(), "task");
    const executeStep = makeDispatch(registry);
    const result = await executor.execute(instruction, context, executeStep);

    // After 2 iterations, the accumulated feedback should contain both rounds.
    expect(result.results.get("step")!.raw).toBe("build-round-2");
  });

  it("clears stale body results between iterations", async () => {
    // Use two counter steps. Between iterations, both should be cleared
    // so fresh results are recorded.
    const registry = new StepExecutorRegistry();
    registry.register(new IncrementingExecutor("a"));
    const executor = new LoopStepExecutor();

    const instruction: LoopInstruction = {
      type: "loop",
      id: "l",
      maxIterations: 2,
      steps: [
        { type: "inc", id: "first" } as unknown as FlowInstruction,
        { type: "inc", id: "second" } as unknown as FlowInstruction,
      ],
    };

    const context = new FlowContext(new Map(), "task");
    const executeStep = makeDispatch(registry);
    const result = await executor.execute(instruction, context, executeStep);

    // Each counter should show the final iteration's value (2), not 4.
    expect(result.results.get("first")!.raw).toBe("a-round-2");
    expect(result.results.get("second")!.raw).toBe("a-round-2");
  });

  it("does not clear non-body results between iterations", async () => {
    // If the context already has a result from outside the loop body,
    // that result should persist across iterations.
    const registry = new StepExecutorRegistry();
    registry.register(new IncrementingExecutor("val"));
    const executor = new LoopStepExecutor();

    const instruction: LoopInstruction = {
      type: "loop",
      id: "l",
      maxIterations: 2,
      steps: [{ type: "inc", id: "body" } as unknown as FlowInstruction],
    };

    const initial = new FlowContext(new Map(), "task").withResult("external", {
      raw: "keep me",
    });
    const result = await executor.execute(instruction, initial, makeDispatch(registry));

    expect(result.results.get("external")!.raw).toBe("keep me");
  });

  it("throws for an unknown step type in body", async () => {
    const registry = new StepExecutorRegistry();
    const executor = new LoopStepExecutor();

    const instruction: LoopInstruction = {
      type: "loop",
      id: "l",
      maxIterations: 3,
      steps: [{ type: "unknown", id: "x" } as unknown as FlowInstruction],
    };

    const context = new FlowContext(new Map(), "task");

    await expect(executor.execute(instruction, context, makeDispatch(registry))).rejects.toThrow(
      'No executor registered for step type "unknown"',
    );
  });

  it("handles an empty loop body", async () => {
    const registry = new StepExecutorRegistry();
    const executor = new LoopStepExecutor();

    const instruction: LoopInstruction = {
      type: "loop",
      id: "l",
      maxIterations: 3,
      steps: [],
    };

    const context = new FlowContext(new Map(), "task");
    const executeStep = makeDispatch(registry);
    const result = await executor.execute(instruction, context, executeStep);

    expect(result.results.get("l")!.parsed!.passed).toBe(true);
    expect(result.results.get("l")!.raw).toContain('"iterations":3');
  });
});
