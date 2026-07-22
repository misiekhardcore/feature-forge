import type { DisplayContribution } from "@feature-forge/tui";
import { createAccumulatedState, DisplayContributionRegistry } from "@feature-forge/tui";
import { describe, expect, it } from "vitest";

import { makeMockTypedEventBus } from "../../test-utils";
import { FlowContext } from "../FlowContext";
import type { FlowInstruction, LoopInstruction } from "../FlowInstruction";
import type { RoutineProgressEvent } from "../RoutineProgress";
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

describe("LoopStepExecutor", () => {
  it("executes body steps for each iteration up to maxIterations", async () => {
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
    const executeStep = makeDispatch(registry);
    const result = await executor.execute(
      instruction,
      context,
      executeStep,
      makeMockTypedEventBus(),
    );

    expect(result.results.get("counter")!.raw).toBe("val-round-3");
    expect(result.results.get("counter_count")!.raw).toBe("3");
    expect(result.results.get("l")!.parsed!.passed).toBe(true);
  });

  it("stops early when continueWhile evaluates to false", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(() => new ParseJsonExecutor());
    const executor = new LoopStepExecutor();

    const instruction: LoopInstruction = {
      type: "loop",
      id: "l",
      maxIterations: 5,
      continueWhile: "!results.check?.parsed?.passed",
      accumulateFrom: [],
      steps: [{ type: "parsejson", id: "check" } as unknown as FlowInstruction],
    };

    const context = new FlowContext({ results: new Map(), prompt: "task" });
    const executeStep = makeDispatch(registry);
    const result = await executor.execute(
      instruction,
      context,
      executeStep,
      makeMockTypedEventBus(),
    );

    expect(result.results.get("l")!.raw).toContain('"iterations":2');
    expect(result.results.get("check")!.parsed!.passed).toBe(true);
  });

  it("always runs at least one iteration (do-while semantics)", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(() => new ParseJsonExecutor());
    const executor = new LoopStepExecutor();

    const instruction: LoopInstruction = {
      type: "loop",
      id: "l",
      maxIterations: 3,
      continueWhile: "results.check?.parsed?.passed",
      accumulateFrom: [],
      steps: [{ type: "parsejson", id: "check" } as unknown as FlowInstruction],
    };

    const context = new FlowContext({ results: new Map(), prompt: "task" });
    const executeStep = makeDispatch(registry);
    const result = await executor.execute(
      instruction,
      context,
      executeStep,
      makeMockTypedEventBus(),
    );

    expect(result.results.get("l")!.raw).toContain('"iterations":1');
  });

  it("stops when maxIterations is reached even if continueWhile is true", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(
      () =>
        new (class extends StepExecutor {
          readonly type = "always-fail";
          async execute(instruction: FlowInstruction, context: FlowContext): Promise<FlowContext> {
            return context.withResult(instruction.id, {
              raw: JSON.stringify({ passed: false, summary: "fail" }),
              parsed: {
                passed: false,
                summary: "1 critical",
                details: { findings: { critical: ["always fails"], warnings: [], info: [] } },
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

    const context = new FlowContext({ results: new Map(), prompt: "task" });
    const executeStep = makeDispatch(registry);
    const result = await executor.execute(
      instruction,
      context,
      executeStep,
      makeMockTypedEventBus(),
    );

    expect(result.results.get("l")!.raw).toContain('"iterations":3');
  });

  it("accumulates feedback from accumulateFrom steps", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(() => new IncrementingExecutor("build"));
    const executor = new LoopStepExecutor();

    const instruction: LoopInstruction = {
      type: "loop",
      id: "l",
      maxIterations: 2,
      accumulateFrom: ["step"],
      steps: [{ type: "inc", id: "step" } as unknown as FlowInstruction],
    };

    const context = new FlowContext({ results: new Map(), prompt: "task" });
    const executeStep = makeDispatch(registry);
    const result = await executor.execute(
      instruction,
      context,
      executeStep,
      makeMockTypedEventBus(),
    );

    expect(result.results.get("step")!.raw).toBe("build-round-2");
  });

  it("clears stale body results between iterations", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(() => new IncrementingExecutor("a"));
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

    const context = new FlowContext({ results: new Map(), prompt: "task" });
    const executeStep = makeDispatch(registry);
    const result = await executor.execute(
      instruction,
      context,
      executeStep,
      makeMockTypedEventBus(),
    );

    expect(result.results.get("first")!.raw).toBe("a-round-2");
    expect(result.results.get("second")!.raw).toBe("a-round-2");
  });

  it("does not clear non-body results between iterations", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(() => new IncrementingExecutor("val"));
    const executor = new LoopStepExecutor();

    const instruction: LoopInstruction = {
      type: "loop",
      id: "l",
      maxIterations: 2,
      steps: [{ type: "inc", id: "body" } as unknown as FlowInstruction],
    };

    const initial = new FlowContext({ results: new Map(), prompt: "task" }).withResult("external", {
      raw: "keep me",
    });
    const result = await executor.execute(
      instruction,
      initial,
      makeDispatch(registry),
      makeMockTypedEventBus(),
    );

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

    const context = new FlowContext({ results: new Map(), prompt: "task" });

    await expect(
      executor.execute(instruction, context, makeDispatch(registry), makeMockTypedEventBus()),
    ).rejects.toThrow('No executor registered for step type "unknown"');
  });

  it("throws AbortError when signal is aborted before the first iteration", async () => {
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
    const controller = new AbortController();
    controller.abort();

    await expect(
      executor.execute(
        instruction,
        context,
        makeDispatch(registry),
        makeMockTypedEventBus(),
        controller.signal,
      ),
    ).rejects.toThrow();
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

    const context = new FlowContext({ results: new Map(), prompt: "task" });
    const executeStep = makeDispatch(registry);
    const result = await executor.execute(
      instruction,
      context,
      executeStep,
      makeMockTypedEventBus(),
    );

    expect(result.results.get("l")!.parsed!.passed).toBe(true);
    expect(result.results.get("l")!.raw).toContain('"iterations":3');
  });

  describe("eventBus", () => {
    it("emits loop-round-start and loop-round-complete for each iteration", async () => {
      const registry = new StepExecutorRegistry();
      registry.register(() => new IncrementingExecutor("val"));
      const executor = new LoopStepExecutor();

      const instruction: LoopInstruction = {
        type: "loop",
        id: "l",
        maxIterations: 2,
        steps: [{ type: "inc", id: "counter" } as unknown as FlowInstruction],
      };

      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const executeStep = makeDispatch(registry);

      const eventBus = makeMockTypedEventBus();
      await executor.execute(instruction, context, executeStep, eventBus);

      // 2 iterations × 2 events (start + complete) = 4 events.
      expect(eventBus.raw.emit).toHaveBeenCalledTimes(4);
      expect(eventBus.raw.emit).toHaveBeenNthCalledWith(
        1,
        "feature-forge:loop-round-start",
        expect.objectContaining({
          phase: "loop-round-start",
          details: expect.objectContaining({ round: 1 }),
        }),
      );
      expect(eventBus.raw.emit).toHaveBeenNthCalledWith(
        2,
        "feature-forge:loop-round-complete",
        expect.objectContaining({
          phase: "loop-round-complete",
          details: expect.objectContaining({ round: 1 }),
        }),
      );
      expect(eventBus.raw.emit).toHaveBeenNthCalledWith(
        3,
        "feature-forge:loop-round-start",
        expect.objectContaining({
          details: expect.objectContaining({ round: 2 }),
        }),
      );
      expect(eventBus.raw.emit).toHaveBeenNthCalledWith(
        4,
        "feature-forge:loop-round-complete",
        expect.objectContaining({
          details: expect.objectContaining({ round: 2 }),
        }),
      );
    });

    it("works with a mocked eventBus", async () => {
      const registry = new StepExecutorRegistry();
      registry.register(() => new IncrementingExecutor("val"));
      const executor = new LoopStepExecutor();

      const instruction: LoopInstruction = {
        type: "loop",
        id: "l",
        maxIterations: 2,
        steps: [{ type: "inc", id: "counter" } as unknown as FlowInstruction],
      };

      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const executeStep = makeDispatch(registry);

      const result = await executor.execute(
        instruction,
        context,
        executeStep,
        makeMockTypedEventBus(),
      );

      expect(result.results.get("l")!.parsed!.passed).toBe(true);
    });
  });

  describe("getDisplayContribution", () => {
    const executor = new LoopStepExecutor();

    it("returns iteration and maxIterations for loop-round-start events", () => {
      const contrib = executor.getDisplayContribution({
        phase: "loop-round-start",
        message: 'Loop "l" — round 2/5',
        details: { round: 2, maxIterations: 5 },
      } satisfies RoutineProgressEvent);

      expect(contrib).toBeDefined();
      expect(contrib!.type).toBe("loop");
      const loopContrib = contrib! as DisplayContribution & {
        type: "loop";
        iteration: number;
        maxIterations: number;
      };
      expect(loopContrib.iteration).toBe(1); // rounds - 1 (0-based)
      expect(loopContrib.maxIterations).toBe(5);
    });

    it("returns iteration and maxIterations for loop-round-complete events", () => {
      const contrib = executor.getDisplayContribution({
        phase: "loop-round-complete",
        message: 'Loop "l" — round 3 complete',
        details: { round: 3, maxIterations: 3 },
      } satisfies RoutineProgressEvent);

      expect(contrib).toBeDefined();
      expect(contrib!.type).toBe("loop");
      const loopContrib = contrib! as DisplayContribution & {
        type: "loop";
        iteration: number;
        maxIterations: number;
      };
      expect(loopContrib.iteration).toBe(2);
      expect(loopContrib.maxIterations).toBe(3);
    });

    it("defaults maxIterations to 0 when not present in details", () => {
      const contrib = executor.getDisplayContribution({
        phase: "loop-round-start",
        message: "Loop started",
        // @ts-expect-error checking edge case
        details: { round: 1 },
      } satisfies RoutineProgressEvent);

      expect(contrib).toBeDefined();
      const loopContrib = contrib! as DisplayContribution & { type: "loop"; maxIterations: number };
      expect(loopContrib.maxIterations).toBe(0);
    });

    it("returns undefined for non-loop phase events", () => {
      const contrib = executor.getDisplayContribution({
        phase: "agent-started",
        message: "Agent started",
        details: { agentId: "", executionId: "" },
      } satisfies RoutineProgressEvent);

      expect(contrib).toBeUndefined();
    });
  });

  describe("registerDisplayHandler", () => {
    it("registers a loop handler that updates iteration and maxIterations", () => {
      const executor = new LoopStepExecutor();
      const registry = new DisplayContributionRegistry();
      executor.registerDisplayHandler(registry);

      const state = createAccumulatedState();
      registry.apply(state, [
        {
          type: "loop",
          iteration: 0,
          maxIterations: 3,
          continueWhile: "x < 5",
          phase: "test",
          message: "test",
        },
      ]);

      expect(state.iteration).toBe(0);
      expect(state.maxIterations).toBe(3);
      expect(state.continueWhile).toBe("x < 5");
    });

    it("only sets fields that are present in the contribution", () => {
      const executor = new LoopStepExecutor();
      const registry = new DisplayContributionRegistry();
      executor.registerDisplayHandler(registry);

      const state = createAccumulatedState();
      registry.apply(state, [
        { type: "loop", iteration: 1, maxIterations: 0, phase: "test", message: "test" },
      ]);

      expect(state.iteration).toBe(1);
      expect(state.maxIterations).toBe(0);
      expect(state.continueWhile).toBeUndefined();
    });
  });
});
