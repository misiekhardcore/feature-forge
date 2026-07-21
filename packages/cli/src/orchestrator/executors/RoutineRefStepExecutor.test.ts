import { describe, expect, it } from "vitest";

import { makeMockTypedEventBus } from "../../test-utils";
import { TypedEventBus } from "../eventBus";
import { FlowContext } from "../FlowContext";
import type { FlowDefinition, FlowInstruction, RoutineRefInstruction } from "../FlowInstruction";
import { createAccumulatedState } from "../progress/AccumulatedState";
import { DisplayContributionRegistry } from "../progress/DisplayContributionRegistry";
import type { RoutineProgressEvent } from "../RoutineProgress";
import { StepExecutor } from "../StepExecutor";
import { StepExecutorRegistry } from "../StepExecutorRegistry";
import { MAX_NESTING_DEPTH, MaxDepthExceededError } from "./MaxDepthExceededError";
import { RoutineRefStepExecutor } from "./RoutineRefStepExecutor";

// ── Helpers ──────────────────────────────────────────────────

class RecordExecutor extends StepExecutor {
  readonly type = "record";

  static executed: { id: string }[] = [];
  static reset(): void {
    RecordExecutor.executed = [];
  }

  async execute(instruction: FlowInstruction, context: FlowContext): Promise<FlowContext> {
    RecordExecutor.executed.push({ id: instruction.id });
    return context.withResult(instruction.id, {
      raw: `done:${instruction.id}`,
      parsed: { passed: true, summary: `ok:${instruction.id}` },
    });
  }
}

class FailingExecutor extends StepExecutor {
  readonly type = "fail";

  async execute(instruction: FlowInstruction): Promise<FlowContext> {
    throw new Error(`step ${instruction.id} failed intentionally`);
  }
}

function makeDispatch(
  registry: StepExecutorRegistry,
  eventBus: TypedEventBus = makeMockTypedEventBus(),
): (
  instruction: FlowInstruction,
  context: FlowContext,
  signal?: AbortSignal,
) => Promise<FlowContext> {
  return async (instruction: FlowInstruction, ctx: FlowContext, signal?: AbortSignal) => {
    const executor = registry.get(instruction.type);
    if (!executor) throw new Error(`Unknown step type: ${instruction.type}`);
    return executor.execute(instruction, ctx, makeDispatch(registry, eventBus), eventBus, signal);
  };
}

function makeTargetFlow(overrides: Partial<FlowDefinition> = {}): FlowDefinition {
  return {
    $schema:
      "https://raw.githubusercontent.com/misiekhardcore/feature-forge/main/packages/cli/src/flows/flow-schema.json",
    name: "review",
    command: "/review",
    orchestrator: { systemPrompt: "t" },
    routines: [
      {
        id: "inspect",
        params: [],
        steps: [
          { type: "record", id: "check_a" } as unknown as FlowInstruction,
          { type: "record", id: "check_b" } as unknown as FlowInstruction,
        ],
      },
    ],
    ...overrides,
  };
}

function makeRefInstruction(overrides: Partial<RoutineRefInstruction> = {}): RoutineRefInstruction {
  return {
    type: "routine",
    id: "call-review",
    target: "review",
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────

describe("RoutineRefStepExecutor", () => {
  describe("execute", () => {
    it("inlines all steps from the target flow with namespaced IDs", async () => {
      RecordExecutor.reset();
      const registry = new StepExecutorRegistry();
      registry.register(() => new RecordExecutor());

      const targetFlow = makeTargetFlow();
      const flowMap = new Map([[targetFlow.name, targetFlow]]);

      const executor = new RoutineRefStepExecutor();
      executor.setFlowMap(flowMap);

      const eventBus = makeMockTypedEventBus();
      const context = new FlowContext({ results: new Map(), prompt: "test" });
      const instruction = makeRefInstruction();

      await executor.execute(instruction, context, makeDispatch(registry, eventBus), eventBus);

      expect(RecordExecutor.executed).toHaveLength(2);
      expect(RecordExecutor.executed[0].id).toBe("call-review.review.check_a");
      expect(RecordExecutor.executed[1].id).toBe("call-review.review.check_b");
    });

    it("increments depth by 1 for the inlined group", async () => {
      RecordExecutor.reset();
      const registry = new StepExecutorRegistry();
      registry.register(() => new RecordExecutor());

      const targetFlow = makeTargetFlow();
      const flowMap = new Map([[targetFlow.name, targetFlow]]);

      const executor = new RoutineRefStepExecutor();
      executor.setFlowMap(flowMap);

      const eventBus = makeMockTypedEventBus();
      const context = new FlowContext({ results: new Map(), prompt: "test", depth: 3 });

      // Capture depth seen by child steps.
      const depths: number[] = [];
      class DepthAwareExecutor extends StepExecutor {
        readonly type = "depth-check";
        async execute(_: FlowInstruction, ctx: FlowContext): Promise<FlowContext> {
          depths.push(ctx.depth);
          return ctx;
        }
      }

      const depthRegistry = new StepExecutorRegistry();
      depthRegistry.register(() => new DepthAwareExecutor());

      const depthFlow: FlowDefinition = {
        $schema: targetFlow.$schema,
        name: "depth-test",
        command: "/depth-test",
        orchestrator: { systemPrompt: "t" },
        routines: [
          {
            id: "main",
            params: [],
            steps: [{ type: "depth-check", id: "d" } as unknown as FlowInstruction],
          },
        ],
      };
      const depthFlowMap = new Map([[depthFlow.name, depthFlow]]);
      executor.setFlowMap(depthFlowMap);

      await executor.execute(
        { type: "routine", id: "r", target: "depth-test" },
        context,
        makeDispatch(depthRegistry, eventBus),
        eventBus,
      );

      expect(depths).toEqual([4]);
    });

    it("throws MaxDepthExceededError when depth limit is reached", async () => {
      const registry = new StepExecutorRegistry();
      registry.register(() => new RecordExecutor());

      const targetFlow = makeTargetFlow();
      const flowMap = new Map([[targetFlow.name, targetFlow]]);

      const executor = new RoutineRefStepExecutor();
      executor.setFlowMap(flowMap);

      const eventBus = makeMockTypedEventBus();
      const context = new FlowContext({
        results: new Map(),
        prompt: "test",
        depth: MAX_NESTING_DEPTH - 1,
      });
      const instruction = makeRefInstruction();

      await expect(
        executor.execute(instruction, context, makeDispatch(registry, eventBus), eventBus),
      ).rejects.toThrow(MaxDepthExceededError);
    });

    it("throws for unknown target flow", async () => {
      const registry = new StepExecutorRegistry();
      registry.register(() => new RecordExecutor());

      const executor = new RoutineRefStepExecutor();
      executor.setFlowMap(new Map());

      const eventBus = makeMockTypedEventBus();
      const context = new FlowContext({ results: new Map(), prompt: "test" });

      await expect(
        executor.execute(
          makeRefInstruction({ target: "nonexistent" }),
          context,
          makeDispatch(registry, eventBus),
          eventBus,
        ),
      ).rejects.toThrow('Unknown target flow "nonexistent"');
    });

    it("emits routine-ref-start and routine-ref-done events", async () => {
      RecordExecutor.reset();
      const registry = new StepExecutorRegistry();
      registry.register(() => new RecordExecutor());

      const targetFlow = makeTargetFlow();
      const flowMap = new Map([[targetFlow.name, targetFlow]]);

      const executor = new RoutineRefStepExecutor();
      executor.setFlowMap(flowMap);

      const eventBus = makeMockTypedEventBus();
      const events: RoutineProgressEvent[] = [];
      eventBus.on("feature-forge:routine-ref-start", (e) => events.push(e));
      eventBus.on("feature-forge:routine-ref-done", (e) => events.push(e));

      const context = new FlowContext({ results: new Map(), prompt: "test" });
      await executor.execute(
        makeRefInstruction(),
        context,
        makeDispatch(registry, eventBus),
        eventBus,
      );

      expect(events).toHaveLength(2);
      expect(events[0].phase).toBe("routine-ref-start");
      expect(events[1].phase).toBe("routine-ref-done");
      expect(
        (
          events[1].details as {
            instructionId: string;
            target: string;
            flow: string;
            passed: boolean;
          }
        ).passed,
      ).toBe(true);
    });

    it("propagates step failures and records error result", async () => {
      const registry = new StepExecutorRegistry();
      registry.register(() => new FailingExecutor());

      const targetFlow = makeTargetFlow({
        routines: [
          {
            id: "inspect",
            params: [],
            steps: [{ type: "fail", id: "bad_step" } as unknown as FlowInstruction],
          },
        ],
      });
      const flowMap = new Map([[targetFlow.name, targetFlow]]);

      const executor = new RoutineRefStepExecutor();
      executor.setFlowMap(flowMap);

      const eventBus = makeMockTypedEventBus();
      const context = new FlowContext({ results: new Map(), prompt: "test" });

      const resultCtx = await executor.execute(
        makeRefInstruction(),
        context,
        makeDispatch(registry, eventBus),
        eventBus,
      );

      const result = resultCtx.results.get("call-review");
      expect(result).toBeDefined();
      expect(result!.parsed?.passed).toBe(false);
    });

    it("stores result under output_as when provided", async () => {
      RecordExecutor.reset();
      const registry = new StepExecutorRegistry();
      registry.register(() => new RecordExecutor());

      const targetFlow = makeTargetFlow();
      const flowMap = new Map([[targetFlow.name, targetFlow]]);

      const executor = new RoutineRefStepExecutor();
      executor.setFlowMap(flowMap);

      const eventBus = makeMockTypedEventBus();
      const context = new FlowContext({ results: new Map(), prompt: "test" });

      const resultCtx = await executor.execute(
        makeRefInstruction({ output_as: "review_result" }),
        context,
        makeDispatch(registry, eventBus),
        eventBus,
      );

      expect(resultCtx.results.has("review_result")).toBe(true);
      expect(resultCtx.results.get("review_result")!.parsed?.passed).toBe(true);
    });

    it("executes all routines when target flow has multiple routines", async () => {
      RecordExecutor.reset();
      const registry = new StepExecutorRegistry();
      registry.register(() => new RecordExecutor());

      const multiRoutineFlow: FlowDefinition = {
        $schema: makeTargetFlow().$schema,
        name: "multi",
        command: "/multi",
        orchestrator: { systemPrompt: "t" },
        routines: [
          {
            id: "first",
            params: [],
            steps: [{ type: "record", id: "a" } as unknown as FlowInstruction],
          },
          {
            id: "second",
            params: [],
            steps: [{ type: "record", id: "b" } as unknown as FlowInstruction],
          },
          {
            id: "third",
            params: [],
            steps: [{ type: "record", id: "c" } as unknown as FlowInstruction],
          },
        ],
      };
      const flowMap = new Map([[multiRoutineFlow.name, multiRoutineFlow]]);

      const executor = new RoutineRefStepExecutor();
      executor.setFlowMap(flowMap);

      const eventBus = makeMockTypedEventBus();
      const context = new FlowContext({ results: new Map(), prompt: "test" });

      await executor.execute(
        { type: "routine", id: "r", target: "multi" },
        context,
        makeDispatch(registry, eventBus),
        eventBus,
      );

      expect(RecordExecutor.executed).toHaveLength(3);
      expect(RecordExecutor.executed[0].id).toBe("r.multi.a");
      expect(RecordExecutor.executed[1].id).toBe("r.multi.b");
      expect(RecordExecutor.executed[2].id).toBe("r.multi.c");
    });

    it("merges input params into context before inlining steps", async () => {
      const capturedParams: Array<ReadonlyMap<string, string>> = [];
      class ParamCheckExecutor extends StepExecutor {
        readonly type = "param-check";
        async execute(_: FlowInstruction, ctx: FlowContext): Promise<FlowContext> {
          capturedParams.push(ctx.params);
          return ctx;
        }
      }

      const registry = new StepExecutorRegistry();
      registry.register(() => new ParamCheckExecutor());

      const targetFlow = makeTargetFlow({
        routines: [
          {
            id: "inspect",
            params: [],
            steps: [
              { type: "param-check", id: "step1" } as unknown as FlowInstruction,
              { type: "param-check", id: "step2" } as unknown as FlowInstruction,
            ],
          },
        ],
      });
      const flowMap = new Map([[targetFlow.name, targetFlow]]);

      const executor = new RoutineRefStepExecutor();
      executor.setFlowMap(flowMap);

      const eventBus = makeMockTypedEventBus();
      const context = new FlowContext({
        results: new Map(),
        prompt: "test",
        params: new Map([["existing", "from-parent"]]),
      });

      await executor.execute(
        makeRefInstruction({
          input: { output: "builder-result", workspace: "/tmp/ws" },
        }),
        context,
        makeDispatch(registry, eventBus),
        eventBus,
      );

      expect(capturedParams).toHaveLength(2);
      for (const params of capturedParams) {
        expect(params.get("existing")).toBe("from-parent");
        expect(params.get("output")).toBe("builder-result");
        expect(params.get("workspace")).toBe("/tmp/ws");
      }
    });

    it("propagates abort signal to inlined step execution", async () => {
      const registry = new StepExecutorRegistry();
      registry.register(() => new RecordExecutor());

      const targetFlow = makeTargetFlow();
      const flowMap = new Map([[targetFlow.name, targetFlow]]);

      const executor = new RoutineRefStepExecutor();
      executor.setFlowMap(flowMap);

      const eventBus = makeMockTypedEventBus();
      const context = new FlowContext({ results: new Map(), prompt: "test" });

      const controller = new AbortController();
      controller.abort();

      await expect(
        executor.execute(
          makeRefInstruction(),
          context,
          makeDispatch(registry, eventBus),
          eventBus,
          controller.signal,
        ),
      ).rejects.toThrow();
    });
  });

  describe("getDisplayContribution", () => {
    it("returns RoutineRefContribution for routine-ref events", () => {
      const executor = new RoutineRefStepExecutor();

      const startEvent: RoutineProgressEvent = {
        phase: "routine-ref-start",
        message: "started",
        details: { instructionId: "r", target: "review", flow: "review" },
      };
      expect(executor.getDisplayContribution(startEvent)).toEqual({
        type: "routine-ref",
        flow: "review",
        status: "started",
        phase: "routine-ref-start",
        message: "started",
      });

      const doneEvent: RoutineProgressEvent = {
        phase: "routine-ref-done",
        message: "done",
        details: { instructionId: "r", target: "review", flow: "review", passed: true },
      };
      expect(executor.getDisplayContribution(doneEvent)).toEqual({
        type: "routine-ref",
        flow: "review",
        status: "done",
        phase: "routine-ref-done",
        message: "done",
      });

      const errorEvent: RoutineProgressEvent = {
        phase: "routine-ref-error",
        message: "error",
        details: { instructionId: "r", target: "review", flow: "review", stepId: "check_a" },
      };
      expect(executor.getDisplayContribution(errorEvent)).toEqual({
        type: "routine-ref",
        flow: "review",
        status: "error",
        phase: "routine-ref-error",
        message: "error",
      });
    });

    it("returns undefined for non-routine-ref events", () => {
      const executor = new RoutineRefStepExecutor();
      expect(
        executor.getDisplayContribution({
          phase: "agent-started",
          message: "x",
          details: { executionId: "e", agentId: "a" },
        }),
      ).toBeUndefined();
    });
  });

  describe("registerDisplayHandler", () => {
    it("adds target flows to routineRefs in AccumulatedState", () => {
      const executor = new RoutineRefStepExecutor();
      const registry = new DisplayContributionRegistry();
      executor.registerDisplayHandler(registry);

      const state = createAccumulatedState();

      registry.apply(state, [
        {
          type: "routine-ref",
          flow: "review",
          status: "started",
          phase: "routine-ref-start",
          message: "starting review",
        },
        {
          type: "routine-ref",
          flow: "verify",
          status: "started",
          phase: "routine-ref-start",
          message: "starting verify",
        },
      ]);

      expect(state.routineRefs).toEqual(["review", "verify"]);
    });

    it("does not duplicate flow names", () => {
      const executor = new RoutineRefStepExecutor();
      const registry = new DisplayContributionRegistry();
      executor.registerDisplayHandler(registry);

      const state = createAccumulatedState();

      registry.apply(state, [
        {
          type: "routine-ref",
          flow: "review",
          status: "started",
          phase: "routine-ref-start",
          message: "start",
        },
        {
          type: "routine-ref",
          flow: "review",
          status: "done",
          phase: "routine-ref-done",
          message: "done",
        },
        {
          type: "routine-ref",
          flow: "review",
          status: "error",
          phase: "routine-ref-error",
          message: "error",
        },
      ]);

      expect(state.routineRefs).toEqual(["review"]);
    });
  });
});
