import { FlowContext } from "@feature-forge/core/src/flows/FlowContext";
import type {
  FlowDefinition,
  FlowInstruction,
  RoutineRefInstruction,
} from "@feature-forge/core/src/flows/FlowInstruction";
import { FlowStateStore } from "@feature-forge/core/src/flows/FlowStateStore";
import { RoutineExecutor } from "@feature-forge/core/src/routines/RoutineExecutor";
import type { RoutineProgressEvent } from "@feature-forge/core/src/routines/RoutineProgress";
import { makeMockToolRegistry, makeMockTypedEventBus } from "@feature-forge/core/src/test-utils";
import { describe, expect, it } from "vitest";

import { TypedEventBus } from "../event-bus";
import { MAX_NESTING_DEPTH, MaxDepthExceededError } from "./MaxDepthExceededError";
import { RoutineRefStepExecutor } from "./RoutineRefStepExecutor";
import { SessionStepExecutor } from "./SessionStepExecutor";
import { StepExecutor } from "./StepExecutor";
import { StepExecutorRegistry } from "./StepExecutorRegistry";

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
      "https://raw.githubusercontent.com/misiekhardcore/feature-forge/main/packages/core/src/flows/flow-schema.json",
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

    it("carries the inlined steps' namespaced outputs in results", async () => {
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
        makeRefInstruction(),
        context,
        makeDispatch(registry, eventBus),
        eventBus,
      );

      const result = resultCtx.results.get("call-review")!;
      // The envelope stays for backward compat (continueWhile reads parsed.passed).
      const raw = JSON.parse(result.raw) as { passed: boolean; routines: string[] };
      expect(raw.passed).toBe(true);
      expect(raw.routines).toEqual(["inspect"]);
      // The namespaced step raws are attached for loop feedback.
      expect(result.results).toEqual({
        "call-review.review.check_a": "done:call-review.review.check_a",
        "call-review.review.check_b": "done:call-review.review.check_b",
      });
    });

    it("carries partial step results on failure", async () => {
      const registry = new StepExecutorRegistry();
      registry.register(() => new RecordExecutor());
      registry.register(() => new FailingExecutor());

      const targetFlow = makeTargetFlow({
        routines: [
          {
            id: "inspect",
            params: [],
            steps: [
              { type: "record", id: "ok_step" } as unknown as FlowInstruction,
              { type: "fail", id: "bad_step" } as unknown as FlowInstruction,
            ],
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

      const result = resultCtx.results.get("call-review")!;
      expect(result.parsed?.passed).toBe(false);
      // The step that completed before the failure is still surfaced.
      expect(result.results).toEqual({
        "call-review.review.ok_step": "done:call-review.review.ok_step",
      });
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

    it("inlines only the matching routine for flow.routine targets", async () => {
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

      const resultCtx = await executor.execute(
        { type: "routine", id: "r", target: "multi.second" },
        context,
        makeDispatch(registry, eventBus),
        eventBus,
      );

      expect(RecordExecutor.executed).toHaveLength(1);
      expect(RecordExecutor.executed[0].id).toBe("r.multi.second.b");

      const result = resultCtx.results.get("r");
      expect(result!.parsed?.passed).toBe(true);
      const raw = JSON.parse(result!.raw) as {
        routineCount: number;
        routines: string[];
      };
      expect(raw.routineCount).toBe(1);
      expect(raw.routines).toEqual(["second"]);
    });

    it("throws when flow.routine target references an unknown routine", async () => {
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
        ],
      };
      const flowMap = new Map([[multiRoutineFlow.name, multiRoutineFlow]]);

      const executor = new RoutineRefStepExecutor();
      executor.setFlowMap(flowMap);

      const eventBus = makeMockTypedEventBus();
      const context = new FlowContext({ results: new Map(), prompt: "test" });

      await expect(
        executor.execute(
          { type: "routine", id: "r", target: "multi.nonexistent" },
          context,
          makeDispatch(registry, eventBus),
          eventBus,
        ),
      ).rejects.toThrow('Unknown routine "nonexistent" in flow "multi"');
    });

    it("throws when flow.routine target has more than two dot-separated segments", async () => {
      const registry = new StepExecutorRegistry();
      registry.register(() => new RecordExecutor());

      const targetFlow = makeTargetFlow();
      const flowMap = new Map([[targetFlow.name, targetFlow]]);

      const executor = new RoutineRefStepExecutor();
      executor.setFlowMap(flowMap);

      const eventBus = makeMockTypedEventBus();
      const context = new FlowContext({ results: new Map(), prompt: "test" });

      await expect(
        executor.execute(
          makeRefInstruction({ target: "review.inspect.extra" }),
          context,
          makeDispatch(registry, eventBus),
          eventBus,
        ),
      ).rejects.toThrow('Malformed routine ref target "review.inspect.extra"');
    });

    it("throws when flow.routine target has a trailing dot", async () => {
      const registry = new StepExecutorRegistry();
      registry.register(() => new RecordExecutor());

      const targetFlow = makeTargetFlow();
      const flowMap = new Map([[targetFlow.name, targetFlow]]);

      const executor = new RoutineRefStepExecutor();
      executor.setFlowMap(flowMap);

      const eventBus = makeMockTypedEventBus();
      const context = new FlowContext({ results: new Map(), prompt: "test" });

      await expect(
        executor.execute(
          makeRefInstruction({ target: "review." }),
          context,
          makeDispatch(registry, eventBus),
          eventBus,
        ),
      ).rejects.toThrow('Malformed routine ref target "review."');
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
          input: { changes: "builder-result", workspace: "/tmp/ws" },
        }),
        context,
        makeDispatch(registry, eventBus),
        eventBus,
      );

      expect(capturedParams).toHaveLength(2);
      for (const params of capturedParams) {
        expect(params.get("existing")).toBe("from-parent");
        expect(params.get("changes")).toBe("builder-result");
        expect(params.get("workspace")).toBe("/tmp/ws");
      }
    });

    it("resolves template expressions in input values against parent context before merge", async () => {
      // Regression: unresolved template strings like "{{workspace}}" in
      // input would overwrite the real workspace path, causing the inlined
      // agent's workingDir to resolve to a non-existent directory.
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
            steps: [{ type: "param-check", id: "step1" } as unknown as FlowInstruction],
          },
        ],
      });
      const flowMap = new Map([[targetFlow.name, targetFlow]]);

      const executor = new RoutineRefStepExecutor();
      executor.setFlowMap(flowMap);

      const eventBus = makeMockTypedEventBus();
      // Parent context has a real workspace path and a builder result.
      const context = new FlowContext({
        results: new Map([
          [
            "builder",
            {
              raw: "the actual build output",
              parsed: { passed: true, summary: "ok" },
            },
          ],
        ]),
        prompt: "test",
        params: new Map([["workspace", "/real/workspace/path"]]),
      });

      await executor.execute(
        makeRefInstruction({
          input: {
            changes: "{{results.builder.raw}}",
            workspace: "{{workspace}}",
          },
        }),
        context,
        makeDispatch(registry, eventBus),
        eventBus,
      );

      expect(capturedParams).toHaveLength(1);
      const params = capturedParams[0];
      // The template expressions should be resolved to actual values:
      // "{{results.builder.raw}}" → actual build output
      expect(params.get("changes")).toBe("the actual build output");
      // "{{workspace}}" → real path, NOT the literal template string
      expect(params.get("workspace")).toBe("/real/workspace/path");
    });

    it("session steps inside an inlined routine ref write the parent's store", async () => {
      // AC3: a session step executed via an inlined routine ref must write
      // into the PARENT flow's store, not an isolated child store.
      const registry = new StepExecutorRegistry();
      registry.register(() => new SessionStepExecutor());
      registry.register(() => new RoutineRefStepExecutor());

      const childFlow: FlowDefinition = {
        $schema: makeTargetFlow().$schema,
        name: "child",
        command: "/child",
        orchestrator: { systemPrompt: "t" },
        routines: [
          {
            id: "save_workspace",
            params: [{ name: "key" }, { name: "value" }],
            steps: [
              {
                type: "session",
                id: "set",
                key: "{{key}}",
                value: "{{value}}",
              } as unknown as FlowInstruction,
            ],
          },
        ],
      };
      registry.setFlowMap(new Map([[childFlow.name, childFlow]]));

      const parentFlow: FlowDefinition = {
        $schema: makeTargetFlow().$schema,
        name: "parent",
        command: "/parent",
        orchestrator: { systemPrompt: "t" },
        routines: [
          {
            id: "main",
            params: [],
            steps: [
              {
                type: "routine",
                id: "call-child",
                target: "child.save_workspace",
              } as unknown as FlowInstruction,
            ],
          },
        ],
      };

      const store = new FlowStateStore();
      const executor = new RoutineExecutor(
        parentFlow,
        registry,
        makeMockTypedEventBus(),
        makeMockToolRegistry(),
        store,
      );

      const result = await executor.run(
        "main",
        { key: "workspace", value: "/tmp/parent-ws" },
        "task",
      );

      expect(result.passed).toBe(true);
      expect(store.get("workspace")).toBe("/tmp/parent-ws");
      expect(result.session.workspace).toBe("/tmp/parent-ws");
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
});
