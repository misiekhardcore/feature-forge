import { describe, expect, it } from "vitest";

import { makeMockEventBus } from "../../test-utils";
import { FlowContext } from "../FlowContext";
import type { FlowDefinition, FlowInstruction, RoutineRefInstruction } from "../FlowInstruction";
import { StepExecutorRegistry } from "../StepExecutorRegistry";
import { RoutineRefStepExecutor } from "./RoutineRefStepExecutor";

// ── Helpers ──────────────────────────────────────────────────

/**
 * Build a dispatch callback that delegates through a StepExecutorRegistry,
 * mirroring how RoutineExecutor wires up `executeStep`.
 */
function makeDispatch(
  registry: StepExecutorRegistry,
): (instruction: FlowInstruction, context: FlowContext) => Promise<FlowContext> {
  const dispatch = async (
    instruction: FlowInstruction,
    ctx: FlowContext,
    signal?: AbortSignal,
  ): Promise<FlowContext> => {
    const executor = registry.get(instruction.type);
    if (!executor) {
      throw new Error(`No executor registered for step type "${instruction.type}"`);
    }
    return executor.execute(instruction, ctx, dispatch, makeMockEventBus(), signal);
  };
  return dispatch;
}

/** Create a minimal target flow with one routine. */
function makeTargetFlow(name: string, routines: FlowDefinition["routines"]): FlowDefinition {
  return {
    name,
    command: `/${name}`,
    orchestrator: { systemPrompt: `You are the ${name} orchestrator.` },
    routines,
  };
}

/** Create a minimal routine ref instruction. */
function makeRoutineRef(overrides: Partial<RoutineRefInstruction> = {}): RoutineRefInstruction {
  return {
    type: "routine",
    id: "ref",
    flow: "target",
    routine: "build",
    ...overrides,
  };
}

// ── Mini executors ───────────────────────────────────────────

import { StepExecutor } from "../StepExecutor";

/** An executor that records a simple text result. */
class EchoExecutor extends StepExecutor {
  readonly type = "echo";

  async execute(instruction: FlowInstruction, context: FlowContext): Promise<FlowContext> {
    return context.withResult(instruction.id, {
      raw: `echo:${instruction.id}`,
      parsed: { kind: "build", passed: true, summary: "ok" },
    });
  }
}

/** An executor that records a parseJson-style result. */
class ParseJsonExecutor extends StepExecutor {
  readonly type = "pj";

  async execute(instruction: FlowInstruction, context: FlowContext): Promise<FlowContext> {
    return context.withResult(instruction.id, {
      raw: JSON.stringify({ passed: true }),
      parsed: {
        kind: "review" as const,
        passed: true,
        findings: { critical: [], warnings: [], info: [] },
      },
    });
  }
}

/** An executor that fails. */
class FailingExecutor extends StepExecutor {
  readonly type = "fail";

  async execute(_instruction: FlowInstruction, _context: FlowContext): Promise<FlowContext> {
    throw new Error("simulated failure");
  }
}

// ── Tests ────────────────────────────────────────────────────

describe("RoutineRefStepExecutor", () => {
  it("executes a target routine with a single echo step", async () => {
    const flows = new Map<string, FlowDefinition>();
    flows.set(
      "target",
      makeTargetFlow("target", {
        build: {
          params: [],
          steps: [{ type: "echo", id: "step1" } as unknown as FlowInstruction],
        },
      }),
    );

    const registry = new StepExecutorRegistry();
    registry.register(() => new EchoExecutor());
    const executor = new RoutineRefStepExecutor(flows);

    const instruction = makeRoutineRef();
    const context = new FlowContext({ results: new Map(), prompt: "task" });
    const executeStep = makeDispatch(registry);

    const result = await executor.execute(instruction, context, executeStep, makeMockEventBus());

    // Parent context should have the routine ref's result.
    const refResult = result.results.get("ref");
    expect(refResult).toBeDefined();
    expect(refResult!.parsed!.passed).toBe(true);
    expect(refResult!.raw).toContain("step1");

    // Child step results are merged as properties on the result object.
    const step1Result = (refResult as unknown as Record<string, unknown>)["step1"];
    expect(step1Result).toBeDefined();
  });

  it("merges child result properties for dot-notation access", async () => {
    const flows = new Map<string, FlowDefinition>();
    flows.set(
      "target",
      makeTargetFlow("target", {
        review: {
          params: [],
          steps: [{ type: "pj", id: "inspect" } as unknown as FlowInstruction],
        },
      }),
    );

    const registry = new StepExecutorRegistry();
    registry.register(() => new ParseJsonExecutor());
    const executor = new RoutineRefStepExecutor(flows);

    const instruction = makeRoutineRef({ routine: "review" });
    const context = new FlowContext({ results: new Map(), prompt: "task" });
    const executeStep = makeDispatch(registry);

    const result = await executor.execute(instruction, context, executeStep, makeMockEventBus());

    const refResult = result.results.get("ref");
    expect(refResult).toBeDefined();

    // Dot-notation access: results.ref.inspect.parsed.passed
    const inspect = (refResult as unknown as Record<string, unknown>)["inspect"] as Record<
      string,
      unknown
    >;
    expect(inspect).toBeDefined();
    expect(inspect.raw).toBe(JSON.stringify({ passed: true }));
    expect((inspect as { parsed: Record<string, unknown> }).parsed.passed).toBe(true);
  });

  it("resolves params from the parent context", async () => {
    const flows = new Map<string, FlowDefinition>();
    flows.set(
      "target",
      makeTargetFlow("target", {
        build: {
          params: [{ name: "workspace" }],
          steps: [{ type: "echo", id: "step" } as unknown as FlowInstruction],
        },
      }),
    );

    const registry = new StepExecutorRegistry();
    registry.register(() => new EchoExecutor());
    const executor = new RoutineRefStepExecutor(flows);

    // Parent context has a workspace that maps to a path.
    const parentCtx = new FlowContext({
      results: new Map(),
      prompt: "task",
    }).withWorkspace("ws", {
      path: "/tmp/ws-path",
      createdAt: new Date(),
    } as never);

    const instruction = makeRoutineRef({
      routine: "build",
      params: { workspace: "{{workspace.ws}}" },
    });
    const executeStep = makeDispatch(registry);

    const result = await executor.execute(instruction, parentCtx, executeStep, makeMockEventBus());

    expect(result.results.get("ref")!.parsed!.passed).toBe(true);
  });

  it("throws for unknown flow", async () => {
    const flows = new Map<string, FlowDefinition>();
    const executor = new RoutineRefStepExecutor(flows);

    const instruction = makeRoutineRef({ flow: "nonexistent" });
    const context = new FlowContext({ results: new Map(), prompt: "task" });
    const registry = new StepExecutorRegistry();

    await expect(
      executor.execute(instruction, context, makeDispatch(registry), makeMockEventBus()),
    ).rejects.toThrow('references unknown flow "nonexistent"');
  });

  it("throws for unknown routine in an existing flow", async () => {
    const flows = new Map<string, FlowDefinition>();
    flows.set("target", makeTargetFlow("target", {}));
    const executor = new RoutineRefStepExecutor(flows);

    const instruction = makeRoutineRef({ routine: "nonexistent" });
    const context = new FlowContext({ results: new Map(), prompt: "task" });
    const registry = new StepExecutorRegistry();

    await expect(
      executor.execute(instruction, context, makeDispatch(registry), makeMockEventBus()),
    ).rejects.toThrow('references unknown routine "nonexistent"');
  });

  it("records failure result when a child step throws", async () => {
    const flows = new Map<string, FlowDefinition>();
    flows.set(
      "target",
      makeTargetFlow("target", {
        build: {
          params: [],
          steps: [{ type: "fail", id: "bad" } as unknown as FlowInstruction],
        },
      }),
    );

    const registry = new StepExecutorRegistry();
    registry.register(() => new FailingExecutor());
    const executor = new RoutineRefStepExecutor(flows);

    const instruction = makeRoutineRef();
    const context = new FlowContext({ results: new Map(), prompt: "task" });
    const executeStep = makeDispatch(registry);

    const result = await executor.execute(instruction, context, executeStep, makeMockEventBus());

    const refResult = result.results.get("ref");
    expect(refResult).toBeDefined();
    expect(refResult!.parsed!.passed).toBe(false);
    expect(refResult!.raw).toContain("simulated failure");
  });

  it("propagates AbortError", async () => {
    const flows = new Map<string, FlowDefinition>();
    flows.set(
      "target",
      makeTargetFlow("target", {
        build: {
          params: [],
          steps: [{ type: "echo", id: "step" } as unknown as FlowInstruction],
        },
      }),
    );

    const registry = new StepExecutorRegistry();
    registry.register(() => new EchoExecutor());
    const executor = new RoutineRefStepExecutor(flows);

    const instruction = makeRoutineRef();
    const context = new FlowContext({ results: new Map(), prompt: "task" });
    const controller = new AbortController();
    controller.abort();

    await expect(
      executor.execute(
        instruction,
        context,
        makeDispatch(registry),
        makeMockEventBus(),
        controller.signal,
      ),
    ).rejects.toThrow();
  });

  it("does not mutate parent context's results", async () => {
    const flows = new Map<string, FlowDefinition>();
    flows.set(
      "target",
      makeTargetFlow("target", {
        build: {
          params: [],
          steps: [{ type: "echo", id: "child-step" } as unknown as FlowInstruction],
        },
      }),
    );

    const registry = new StepExecutorRegistry();
    registry.register(() => new EchoExecutor());
    const executor = new RoutineRefStepExecutor(flows);

    const parentCtx = new FlowContext({
      results: new Map(),
      prompt: "task",
    }).withResult("existing", { raw: "keep" });

    const instruction = makeRoutineRef();
    const executeStep = makeDispatch(registry);

    await executor.execute(instruction, parentCtx, executeStep, makeMockEventBus());

    // Parent context should still have its original result unchanged.
    expect(parentCtx.results.get("existing")!.raw).toBe("keep");
    // Parent should NOT contain the child's step result.
    expect(parentCtx.results.has("child-step")).toBe(false);
  });

  it("shares the store with the child context", async () => {
    const flows = new Map<string, FlowDefinition>();
    flows.set(
      "target",
      makeTargetFlow("target", {
        build: {
          params: [],
          steps: [{ type: "echo", id: "step" } as unknown as FlowInstruction],
        },
      }),
    );

    const registry = new StepExecutorRegistry();
    registry.register(() => new EchoExecutor());
    const executor = new RoutineRefStepExecutor(flows);

    const parentCtx = new FlowContext({
      results: new Map(),
      prompt: "task",
    });
    parentCtx.store.set("global-key", "global-value");

    const instruction = makeRoutineRef();
    const executeStep = makeDispatch(registry);

    await executor.execute(instruction, parentCtx, executeStep, makeMockEventBus());

    // Store should still have the value.
    expect(parentCtx.store.get("global-key")).toBe("global-value");
  });

  it("handles a routine ref with no child steps (empty routine)", async () => {
    const flows = new Map<string, FlowDefinition>();
    flows.set(
      "target",
      makeTargetFlow("target", {
        empty: {
          params: [],
          steps: [],
        },
      }),
    );

    const registry = new StepExecutorRegistry();
    const executor = new RoutineRefStepExecutor(flows);

    const instruction = makeRoutineRef({ routine: "empty" });
    const context = new FlowContext({ results: new Map(), prompt: "task" });
    const executeStep = makeDispatch(registry);

    const result = await executor.execute(instruction, context, executeStep, makeMockEventBus());

    const refResult = result.results.get("ref");
    expect(refResult).toBeDefined();
    expect(refResult!.parsed!.passed).toBe(true);
    expect(refResult!.raw).toBe("{}");
  });

  it("forwards AbortSignal to child step dispatch", async () => {
    const signalReceived: boolean[] = [];

    const flows = new Map<string, FlowDefinition>();
    flows.set(
      "target",
      makeTargetFlow("target", {
        build: {
          params: [],
          steps: [{ type: "echo", id: "step" } as unknown as FlowInstruction],
        },
      }),
    );

    const executor = new RoutineRefStepExecutor(flows);

    const instruction = makeRoutineRef();
    const context = new FlowContext({ results: new Map(), prompt: "task" });

    // Custom executeStep that records whether signal was passed.
    const executeStep = async (
      _instruction: FlowInstruction,
      ctx: FlowContext,
      signal?: AbortSignal,
    ): Promise<FlowContext> => {
      signalReceived.push(signal?.aborted ?? false);
      return ctx;
    };

    const controller = new AbortController();

    // Don't abort before — the signal should be non-aborted when passed.
    await executor.execute(
      instruction,
      context,
      executeStep,
      makeMockEventBus(),
      controller.signal,
    );
    expect(signalReceived).toHaveLength(1);
    expect(signalReceived[0]).toBe(false);

    // Now abort and verify the aborted signal is forwarded.
    const abortedController = new AbortController();
    abortedController.abort();
    await expect(
      executor.execute(
        instruction,
        context,
        executeStep,
        makeMockEventBus(),
        abortedController.signal,
      ),
    ).rejects.toThrow();

    // The signal check in the executor loop happens before dispatch,
    // so the second executeStep call with an aborted signal won't reach
    // the custom executeStep — the AbortError is thrown by signal.throwIfAborted().
  });
});
