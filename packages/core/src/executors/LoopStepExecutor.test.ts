import { describe, expect, it } from "vitest";

import { FlowContext } from "../flows/FlowContext";
import type { FlowDefinition, FlowInstruction, LoopInstruction } from "../flows/FlowInstruction";
import { FLOW_SCHEMA_URL } from "../flows/FlowInstruction";
import { makeMockTypedEventBus } from "../test-utils";
import { LoopStepExecutor } from "./LoopStepExecutor";
import { RoutineRefStepExecutor } from "./RoutineRefStepExecutor";
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

  it("derives feedback from a routine-ref result's nested step outputs", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(() => new IncrementingExecutor("build"));
    const executor = new LoopStepExecutor();

    const instruction: LoopInstruction = {
      type: "loop",
      id: "l",
      maxIterations: 2,
      accumulateFrom: ["call_review"],
      steps: [{ type: "inc", id: "step" } as unknown as FlowInstruction],
    };

    // Simulate a routine-ref result: envelope in raw, findings under results.
    const initial = new FlowContext({ results: new Map(), prompt: "task" }).withResult(
      "call_review",
      {
        raw: JSON.stringify({ passed: false, flow: "review", routines: ["inspect"] }),
        parsed: { passed: false, summary: "some steps did not pass" },
        results: {
          "call_review.review.review":
            '{"passed":false,"findings":[{"severity":"P0","issue":"Null deref"}]}',
        },
      },
    );

    const result = await executor.execute(
      instruction,
      initial,
      makeDispatch(registry),
      makeMockTypedEventBus(),
    );

    // The reviewer's actual findings text is fed back — not the envelope JSON.
    expect(result.feedback).toContain('"P0"');
    expect(result.feedback).toContain("Null deref");
    expect(result.feedback).not.toContain('"routines":["inspect"]');
    expect(result.feedback).not.toContain('"routineCount"');
  });

  it("falls back to the plain raw when the accumulated result has no nested results", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(() => new IncrementingExecutor("build"));
    const executor = new LoopStepExecutor();

    const instruction: LoopInstruction = {
      type: "loop",
      id: "l",
      maxIterations: 2,
      accumulateFrom: ["plain"],
      steps: [{ type: "inc", id: "step" } as unknown as FlowInstruction],
    };

    const initial = new FlowContext({ results: new Map(), prompt: "task" }).withResult("plain", {
      raw: "plain-raw-output",
    });

    const result = await executor.execute(
      instruction,
      initial,
      makeDispatch(registry),
      makeMockTypedEventBus(),
    );

    expect(result.feedback).toContain("plain: plain-raw-output");
  });

  it("feeds the inlined reviewer findings into the builder prompt across rounds", async () => {
    // End-to-end shape of the implement build_loop: builder + routine ref to
    // the review flow, accumulateFrom ["call_review"]. The builder's
    // {{feedback}} must contain the reviewer's actual P0/P1 findings.
    const capturedBuilderPrompts: string[] = [];
    class BuilderCaptureExecutor extends StepExecutor {
      readonly type = "builder-capture";
      async execute(instruction: FlowInstruction, context: FlowContext): Promise<FlowContext> {
        capturedBuilderPrompts.push(context.resolve("{{feedback}}"));
        return context.withResult(instruction.id, {
          raw: JSON.stringify({ passed: false, summary: "build attempt" }),
          parsed: { passed: false, summary: "build attempt" },
        });
      }
    }
    class ReviewerExecutor extends StepExecutor {
      readonly type = "review-agent";
      async execute(instruction: FlowInstruction, context: FlowContext): Promise<FlowContext> {
        const findings = JSON.stringify({
          passed: false,
          findings: [
            { severity: "P0", issue: "Unhandled null case in parseConfig", file: "a.ts" },
            { severity: "P1", issue: "Missing error handling", file: "b.ts" },
          ],
        });
        return context.withResult(instruction.id, {
          raw: findings,
          parsed: { passed: false, summary: "2 findings" },
        });
      }
    }

    const registry = new StepExecutorRegistry();
    registry.register(() => new BuilderCaptureExecutor());
    registry.register(() => new ReviewerExecutor());
    const routineExecutor = new RoutineRefStepExecutor();
    registry.register(() => routineExecutor);

    const reviewFlow: FlowDefinition = {
      $schema: FLOW_SCHEMA_URL,
      name: "review",
      command: "/review",
      orchestrator: { systemPrompt: "t" },
      routines: [
        {
          id: "inspect",
          params: [],
          steps: [{ type: "review-agent", id: "review" } as unknown as FlowInstruction],
        },
      ],
    };
    registry.setFlowMap(new Map([[reviewFlow.name, reviewFlow]]));

    const loop = new LoopStepExecutor();
    const instruction: LoopInstruction = {
      type: "loop",
      id: "build_loop",
      maxIterations: 2,
      accumulateFrom: ["call_review"],
      steps: [
        { type: "builder-capture", id: "builder" } as unknown as FlowInstruction,
        {
          type: "routine",
          id: "call_review",
          target: "review",
          output_as: "call_review",
        } as unknown as FlowInstruction,
      ],
    };

    const context = new FlowContext({ results: new Map(), prompt: "task" });
    const result = await loop.execute(
      instruction,
      context,
      makeDispatch(registry),
      makeMockTypedEventBus(),
    );

    // Round 1 has no prior findings; round 2 carries the reviewer's output.
    expect(capturedBuilderPrompts).toHaveLength(2);
    const round2Feedback = capturedBuilderPrompts[1];
    expect(round2Feedback).toContain("Unhandled null case in parseConfig");
    expect(round2Feedback).toContain("Missing error handling");
    expect(round2Feedback).toContain("P0");
    // The envelope must not be what the builder sees.
    expect(round2Feedback).not.toContain('"routineCount"');
    expect(round2Feedback).not.toContain('"flow":"review"');
    // The routine ref still reports failure so continueWhile keeps looping.
    expect(result.results.get("call_review")!.parsed?.passed).toBe(false);
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
});
