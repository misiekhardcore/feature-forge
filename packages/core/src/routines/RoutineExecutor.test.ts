import type { EventBus } from "@earendil-works/pi-coding-agent";
import { TypedEventBus } from "@feature-forge/core/src/event-bus";
import { StepExecutor } from "@feature-forge/core/src/executors/StepExecutor";
import { StepExecutorRegistry } from "@feature-forge/core/src/executors/StepExecutorRegistry";
import { FlowContext } from "@feature-forge/core/src/flows/FlowContext";
import type {
  FlowDefinition,
  FlowInstruction,
} from "@feature-forge/core/src/flows/FlowInstruction";
import { FLOW_SCHEMA_URL } from "@feature-forge/core/src/flows/FlowInstruction";
import { RoutineExecutor } from "@feature-forge/core/src/routines/RoutineExecutor";
import { makeMockToolRegistry, makeMockTypedEventBus } from "@feature-forge/core/src/test-utils";
import { WorkspaceHandle } from "@feature-forge/core/src/workspace/WorkspaceHandle";
import { describe, expect, it, vi } from "vitest";

// ── Helpers ──────────────────────────────────────────────────

class RecordExecutor extends StepExecutor {
  readonly type = "record";
  /** Captured instructions in execution order. */
  static executed: { id: string; task: string }[] = [];

  static reset(): void {
    RecordExecutor.executed = [];
  }

  async execute(
    instruction: FlowInstruction,
    context: FlowContext,
    _executeStep: (instruction: FlowInstruction, context: FlowContext) => Promise<FlowContext>,
    _eventBus: EventBus,
  ): Promise<FlowContext> {
    const instr = instruction as Record<string, unknown>;
    const task = typeof instr.task === "string" ? context.resolve(instr.task) : "";
    RecordExecutor.executed.push({ id: instruction.id, task: task });
    return context.withResult(instruction.id, { raw: `done:${instruction.id}` });
  }
}

class FailingExecutor extends StepExecutor {
  readonly type = "fail";

  async execute(
    instruction: FlowInstruction,
    _context: FlowContext,
    _executeStep: (instruction: FlowInstruction, context: FlowContext) => Promise<FlowContext>,
    _eventBus: EventBus,
  ): Promise<FlowContext> {
    throw new Error(`step ${instruction.id} failed intentionally`);
  }
}

/** Runs each body step once, mimicking the real LoopStepExecutor's result surface. */
class LoopStepExecutorStub extends StepExecutor {
  readonly type = "loop";

  async execute(
    instruction: FlowInstruction,
    context: FlowContext,
    executeStep: (instruction: FlowInstruction, context: FlowContext) => Promise<FlowContext>,
    _eventBus: EventBus,
  ): Promise<FlowContext> {
    const steps = (instruction as { steps: FlowInstruction[] }).steps;
    let current = context;
    for (const step of steps) {
      current = await executeStep(step, current);
    }
    return current.withResult(instruction.id, {
      raw: "loop done",
      parsed: { passed: true, summary: "loop completed" },
    });
  }
}

/** Shell executor that always soft-fails (returns passed:false instead of throwing). */
class SoftFailingShellExecutor extends StepExecutor {
  readonly type = "shell";

  async execute(instruction: FlowInstruction, context: FlowContext): Promise<FlowContext> {
    return context.withResult(instruction.id, {
      raw: "command failed",
      parsed: { passed: false, summary: `shell failed: ${instruction.id}` },
    });
  }
}

/** Loop executor that mimics the LoopStepExecutor's skipped-by-while-guard result surface. */
class SkippedLoopExecutorStub extends StepExecutor {
  readonly type = "loop";

  async execute(instruction: FlowInstruction, context: FlowContext): Promise<FlowContext> {
    return context.withResult(instruction.id, {
      raw: JSON.stringify({ iterations: 0, maxIterations: 3, skipped: true }),
      parsed: { passed: true, summary: "Loop skipped by while-guard" },
      skipped: true,
    });
  }
}

function makeTestFlow(overrides: Partial<FlowDefinition["routines"][number]> = {}): FlowDefinition {
  return {
    $schema: FLOW_SCHEMA_URL,
    name: "test-flow",
    command: "/test",
    orchestrator: { systemPrompt: "You are the test orchestrator." },
    routines: [
      {
        id: "main",
        params: [{ name: "task" }],
        steps: [
          // @ts-expect-error new type test
          { type: "record", id: "step1" },
          {
            // @ts-expect-error new type test
            type: "record",
            id: "step2",
            systemPrompt: "build",
            task: "do {{prompt}} with {{plan}}",
          },
          ...(overrides.steps ?? []),
        ],
        ...overrides,
      },
    ],
  } satisfies FlowDefinition;
}

// ── Tests ────────────────────────────────────────────────────

describe("RoutineExecutor", () => {
  describe("run", () => {
    it("executes all steps in order and returns a passed result", async () => {
      RecordExecutor.reset();
      const registry = new StepExecutorRegistry();
      registry.register(() => new RecordExecutor());
      registry.register(
        () =>
          new (class extends StepExecutor {
            readonly type = "agent";
            async execute(
              instruction: FlowInstruction,
              context: FlowContext,
            ): Promise<FlowContext> {
              RecordExecutor.executed.push({
                id: instruction.id,
                task: context.resolve((instruction as { task?: string }).task ?? ""),
              });
              return context.withResult(instruction.id, { raw: `done:${instruction.id}` });
            }
          })(),
      );

      const flow = makeTestFlow();
      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());

      const result = await executor.run("main", { plan: "use JWT" }, "add auth");

      expect(result.passed).toBe(true);
      expect(result.routine).toBe("main");
      expect(result.rounds).toBe(0);
      expect(result.summary).toContain("completed");

      // Steps executed in order.
      expect(RecordExecutor.executed).toHaveLength(2);
      expect(RecordExecutor.executed[0].id).toBe("step1");
      expect(RecordExecutor.executed[1].id).toBe("step2");

      // Template resolution applied.
      expect(RecordExecutor.executed[1].task).toBe("do add auth with use JWT");
    });

    it("sets rounds to 0 for non-loop routines (regression: was always ≥1)", async () => {
      RecordExecutor.reset();
      const registry = new StepExecutorRegistry();
      registry.register(() => new RecordExecutor());

      const flow = makeTestFlow();
      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());

      const result = await executor.run("main", { plan: "" }, "task");

      expect(result.rounds).toBe(0);
    });

    it("sets rounds to actual iteration count for loop routines", async () => {
      // Simulate a loop that increments context.iteration 3 times.
      class LoopSimulator extends StepExecutor {
        readonly type = "loop-sim";

        async execute(
          _instruction: FlowInstruction,
          context: FlowContext,
          executeStep: (instruction: FlowInstruction, context: FlowContext) => Promise<FlowContext>,
          _eventBus: EventBus,
        ): Promise<FlowContext> {
          let current = context;
          for (let i = 0; i < 3; i++) {
            current = current.withIteration(i + 1);
            current = await executeStep({ type: "record" } as unknown as FlowInstruction, current);
          }
          return current.withResult(_instruction.id, { raw: "loop-done" });
        }
      }

      RecordExecutor.reset();
      const registry = new StepExecutorRegistry();
      registry.register(() => new LoopSimulator());
      registry.register(() => new RecordExecutor());

      const flow = {
        $schema: FLOW_SCHEMA_URL,
        name: "loop-flow",
        command: "/loop-test",
        orchestrator: { systemPrompt: "test" },
        routines: [
          {
            id: "loop-main",
            steps: [{ type: "loop-sim", id: "loop" } as unknown as FlowInstruction],
          },
        ],
      } as unknown as FlowDefinition;

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());

      const result = await executor.run("loop-main", {}, "task");

      expect(result.rounds).toBe(3);
    });

    it("returns per-instruction results", async () => {
      RecordExecutor.reset();
      const registry = new StepExecutorRegistry();
      registry.register(() => new RecordExecutor());
      registry.register(
        () =>
          new (class extends StepExecutor {
            readonly type = "agent";
            async execute(
              instruction: FlowInstruction,
              context: FlowContext,
            ): Promise<FlowContext> {
              RecordExecutor.executed.push({
                id: instruction.id,
                task: context.resolve((instruction as { task?: string }).task ?? ""),
              });
              return context.withResult(instruction.id, { raw: `done:${instruction.id}` });
            }
          })(),
      );

      const flow = makeTestFlow();
      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());

      const result = await executor.run("main", {}, "task");

      expect(result.results["step1"].raw).toBe("done:step1");
      expect(result.results["step2"].raw).toBe("done:step2");
    });

    it("returns the first workspace path in the summary", async () => {
      const registry = new StepExecutorRegistry();
      registry.register(
        () =>
          new (class extends StepExecutor {
            readonly type = "ws";
            async execute(
              instruction: FlowInstruction,
              context: FlowContext,
            ): Promise<FlowContext> {
              return context
                .withWorkspace(
                  instruction.id,
                  new WorkspaceHandle("/tmp/forge-worktree", new Date()),
                )
                .withResult(instruction.id, { raw: "ws created" });
            }
          })(),
      );

      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "ws-flow",
        command: "/ws",
        orchestrator: { systemPrompt: "t" },
        routines: [
          {
            id: "main",
            params: [],
            steps: [{ type: "ws", id: "myws" } as unknown as FlowInstruction],
          },
        ],
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());
      const result = await executor.run("main", {}, "task");
      expect(result.workspace).toBe("/tmp/forge-worktree");
    });

    it("returns a failure result when a step throws", async () => {
      const registry = new StepExecutorRegistry();
      registry.register(() => new FailingExecutor());
      registry.register(() => new RecordExecutor()); // won't run

      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "fail-flow",
        command: "/fail",
        orchestrator: { systemPrompt: "t" },
        routines: [
          {
            id: "main",
            params: [],
            steps: [
              { type: "fail", id: "f1" } as unknown as FlowInstruction,
              { type: "record", id: "after" } as unknown as FlowInstruction,
            ],
          },
        ],
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());
      const result = await executor.run("main", {}, "task");

      expect(result.passed).toBe(false);
      expect(result.summary).toContain("failed");
      expect(result.summary).toContain("step f1 failed intentionally");
    });
    it("returns a failure result when a step result has parsed.passed=false", async () => {
      const registry = new StepExecutorRegistry();
      registry.register(
        () =>
          new (class extends StepExecutor {
            readonly type = "agent";
            async execute(
              instruction: FlowInstruction,
              context: FlowContext,
            ): Promise<FlowContext> {
              return context.withResult(instruction.id, {
                raw: "failed result",
                parsed: { passed: false, summary: "agent failed" },
              });
            }
          })(),
      );

      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "step-fail-flow",
        command: "/step-fail",
        orchestrator: { systemPrompt: "t" },
        routines: [
          {
            id: "main",
            params: [],
            steps: [{ type: "agent", id: "a1" } as unknown as FlowInstruction],
          },
        ],
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());
      const result = await executor.run("main", {}, "task");

      expect(result.passed).toBe(false);
      expect(result.summary).toContain("step result(s) not passed");
      expect(result.results["a1"].parsed?.passed).toBe(false);
    });

    it("does not fail the routine when a failFast:false loop-body step reports passed:false", async () => {
      const registry = new StepExecutorRegistry();
      registry.register(() => new LoopStepExecutorStub());
      registry.register(() => new SoftFailingShellExecutor());

      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "sync-flow",
        command: "/sync",
        orchestrator: { systemPrompt: "t" },
        routines: [
          {
            id: "main",
            params: [],
            steps: [
              {
                type: "loop",
                id: "build_loop",
                maxIterations: 1,
                steps: [
                  {
                    type: "shell",
                    id: "sync",
                    command: "git fetch origin main 2>&1",
                    cwd: "/tmp",
                    failFast: false,
                  },
                ],
              },
            ],
          },
        ],
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());

      const result = await executor.run("main", {}, "task");

      // The non-blocking sync step failed, but the routine must still pass —
      // the failure is informational only (continueWhile gates the loop).
      expect(result.results["sync"].parsed?.passed).toBe(false);
      expect(result.passed).toBe(true);
      // A non-blocking soft failure must not leak into the status derivation.
      expect(result.status).toBe("success");
      expect(result.reason).toBeUndefined();
    });

    it("fails the routine when a loop-body step without failFast:false reports passed:false", async () => {
      const registry = new StepExecutorRegistry();
      registry.register(() => new LoopStepExecutorStub());
      registry.register(() => new SoftFailingShellExecutor());

      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "sync-flow",
        command: "/sync",
        orchestrator: { systemPrompt: "t" },
        routines: [
          {
            id: "main",
            params: [],
            steps: [
              {
                type: "loop",
                id: "build_loop",
                maxIterations: 1,
                steps: [
                  {
                    type: "shell",
                    id: "sync",
                    command: "git fetch origin main",
                    cwd: "/tmp",
                  },
                ],
              },
            ],
          },
        ],
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());

      const result = await executor.run("main", {}, "task");

      expect(result.results["sync"].parsed?.passed).toBe(false);
      expect(result.passed).toBe(false);
    });

    it("throws for an unknown routine name", async () => {
      const registry = new StepExecutorRegistry();
      const flow = makeTestFlow();
      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());

      await expect(executor.run("nonexistent", {}, "task")).rejects.toThrow(
        'Routine "nonexistent" not found',
      );
    });

    it("returns a failure result for an unknown step type", async () => {
      const registry = new StepExecutorRegistry();
      // No "record" executor registered.
      const flow = makeTestFlow();
      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());

      const result = await executor.run("main", {}, "task");

      expect(result.passed).toBe(false);
      expect(result.summary).toContain('No step executor registered for type "record"');
    });

    it("passes eventBus to step executors", async () => {
      RecordExecutor.reset();
      const registry = new StepExecutorRegistry();

      class EventBusAwareExecutor extends StepExecutor {
        readonly type = "event-bus-aware";
        async execute(
          instruction: FlowInstruction,
          context: FlowContext,
          _executeStep: (
            instruction: FlowInstruction,
            context: FlowContext,
          ) => Promise<FlowContext>,
          eventBus: EventBus,
        ): Promise<FlowContext> {
          eventBus.emit("feature-forge:custom-event", {
            phase: "custom-event",
            message: `step ${instruction.id}`,
            details: {},
          });
          return context.withResult(instruction.id, { raw: `done:${instruction.id}` });
        }
      }

      registry.register(() => new EventBusAwareExecutor());

      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "event-bus-flow",
        command: "/event-bus",
        orchestrator: { systemPrompt: "t" },
        routines: [
          {
            id: "main",
            params: [],
            steps: [
              { type: "event-bus-aware", id: "step1" } as unknown as FlowInstruction,
              { type: "event-bus-aware", id: "step2" } as unknown as FlowInstruction,
            ],
          },
        ],
      };

      const emitSpy = vi.fn();
      const eventBus = new TypedEventBus({ emit: emitSpy, on: vi.fn() });

      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());
      const result = await executor.run("main", {}, "task");

      expect(result.passed).toBe(true);
      expect(emitSpy).toHaveBeenCalledTimes(2);
      expect(emitSpy).toHaveBeenNthCalledWith(
        1,
        "feature-forge:custom-event",
        expect.objectContaining({
          phase: "custom-event",
          message: expect.stringContaining("step1") as string,
        }),
      );
      expect(emitSpy).toHaveBeenNthCalledWith(
        2,
        "feature-forge:custom-event",
        expect.objectContaining({
          phase: "custom-event",
          message: expect.stringContaining("step2") as string,
        }),
      );
    });

    it("works with a mocked eventBus", async () => {
      RecordExecutor.reset();
      const registry = new StepExecutorRegistry();
      registry.register(() => new RecordExecutor());

      const flow = makeTestFlow();
      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());

      const result = await executor.run("main", {}, "task");

      expect(result.passed).toBe(true);
    });

    it("passes eventBus to executors when an EventBus is provided", async () => {
      const registry = new StepExecutorRegistry();

      class EventBusAwareExecutor extends StepExecutor {
        readonly type = "event-bus-aware";
        async execute(
          instruction: FlowInstruction,
          context: FlowContext,
          _executeStep: (
            instruction: FlowInstruction,
            context: FlowContext,
          ) => Promise<FlowContext>,
          eventBus: EventBus,
        ): Promise<FlowContext> {
          eventBus.emit("feature-forge:agent-started", {
            phase: "agent-started",
            message: `launching ${instruction.id}`,
            details: { routine: "main" },
          });
          return context.withResult(instruction.id, { raw: `done:${instruction.id}` });
        }
      }

      registry.register(() => new EventBusAwareExecutor());

      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "event-bus-flow",
        command: "/event-bus",
        orchestrator: { systemPrompt: "t" },
        routines: [
          {
            id: "main",
            params: [],
            steps: [{ type: "event-bus-aware", id: "step1" } as unknown as FlowInstruction],
          },
        ],
      };

      const emitSpy = vi.fn();
      const eventBus = new TypedEventBus({ emit: emitSpy, on: vi.fn() });

      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());
      await executor.run("main", {}, "task");

      expect(emitSpy).toHaveBeenCalledWith("feature-forge:agent-started", {
        phase: "agent-started",
        message: "launching step1",
        details: { routine: "main" },
      });
    });

    it("passes the abort signal to step executors", async () => {
      const registry = new StepExecutorRegistry();

      class SignalAwareExecutor extends StepExecutor {
        readonly type = "signal-aware";
        async execute(
          instruction: FlowInstruction,
          context: FlowContext,
          _executeStep: (
            instruction: FlowInstruction,
            context: FlowContext,
            signal?: AbortSignal,
          ) => Promise<FlowContext>,
          _eventBus: EventBus,
          signal?: AbortSignal,
        ): Promise<FlowContext> {
          // Verify signal is the same controller's signal.
          expect(signal).toBeDefined();
          expect(signal!.aborted).toBe(false);
          return context.withResult(instruction.id, { raw: `got-signal:${instruction.id}` });
        }
      }

      registry.register(() => new SignalAwareExecutor());

      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "signal-flow",
        command: "/signal",
        orchestrator: { systemPrompt: "t" },
        routines: [
          {
            id: "main",
            params: [],
            steps: [{ type: "signal-aware", id: "step1" } as unknown as FlowInstruction],
          },
        ],
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());
      const controller = new AbortController();
      const result = await executor.run("main", {}, "task", controller.signal);

      expect(result.passed).toBe(true);
      expect(result.results["step1"].raw).toBe("got-signal:step1");
    });

    it("propagates AbortError when signal is aborted before a step", async () => {
      RecordExecutor.reset();
      const registry = new StepExecutorRegistry();
      registry.register(() => new RecordExecutor());

      const flow = makeTestFlow();
      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());
      const controller = new AbortController();
      controller.abort();

      await expect(executor.run("main", {}, "task", controller.signal)).rejects.toThrow();
      expect(RecordExecutor.executed).toHaveLength(0);
    });

    it("propagates AbortError when signal is aborted during a step", async () => {
      const registry = new StepExecutorRegistry();

      class AbortedDuringStep extends StepExecutor {
        readonly type = "abort-during";
        async execute(
          _instruction: FlowInstruction,
          _context: FlowContext,
          _executeStep: (
            instruction: FlowInstruction,
            context: FlowContext,
            signal?: AbortSignal,
          ) => Promise<FlowContext>,
          _eventBus: EventBus,
          _signal?: AbortSignal,
        ): Promise<FlowContext> {
          throw new DOMException("The operation was aborted.", "AbortError");
        }
      }

      registry.register(() => new AbortedDuringStep());

      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "abort-flow",
        command: "/abort",
        orchestrator: { systemPrompt: "t" },
        routines: [
          {
            id: "main",
            params: [],
            steps: [{ type: "abort-during", id: "step1" } as unknown as FlowInstruction],
          },
        ],
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());

      await expect(executor.run("main", {}, "task")).rejects.toThrow();
    });

    it("runs without a signal (backwards-compatible)", async () => {
      RecordExecutor.reset();
      const registry = new StepExecutorRegistry();
      registry.register(() => new RecordExecutor());

      const flow = makeTestFlow();
      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());

      const result = await executor.run("main", {}, "task");
      expect(result.passed).toBe(true);
    });

    it("includes available routines in the unknown routine error", async () => {
      const registry = new StepExecutorRegistry();
      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "multi",
        command: "/multi",
        orchestrator: { systemPrompt: "t" },
        routines: [
          { id: "alpha", params: [], steps: [] },
          { id: "beta", params: [], steps: [] },
        ],
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());
      await expect(executor.run("gamma", {}, "task")).rejects.toThrow("alpha, beta");
    });
  });

  describe("status derivation", () => {
    it('reports "success" for an all-passing routine', async () => {
      RecordExecutor.reset();
      const registry = new StepExecutorRegistry();
      registry.register(() => new RecordExecutor());

      const flow = makeTestFlow();
      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());

      const result = await executor.run("main", {}, "task");

      expect(result.passed).toBe(true);
      expect(result.status).toBe("success");
      expect(result.reason).toBeUndefined();
    });

    it('reports "skipped" with the skipped step id when a loop is skipped', async () => {
      const registry = new StepExecutorRegistry();
      registry.register(() => new SkippedLoopExecutorStub());

      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "skip-flow",
        command: "/skip",
        orchestrator: { systemPrompt: "t" },
        routines: [
          {
            id: "main",
            params: [],
            steps: [
              {
                type: "loop",
                id: "build_loop",
                maxIterations: 3,
                steps: [{ type: "shell", id: "inner", command: "echo hi", cwd: "/tmp" }],
              },
            ],
          },
        ],
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());

      const result = await executor.run("main", {}, "task");

      // Skipped steps still count as passed for backwards compatibility.
      expect(result.passed).toBe(true);
      expect(result.status).toBe("skipped");
      expect(result.reason).toBe("Skipped step(s): build_loop");
    });

    it("joins multiple skipped step ids in the reason", async () => {
      const registry = new StepExecutorRegistry();
      registry.register(() => new SkippedLoopExecutorStub());

      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "multi-skip-flow",
        command: "/multi-skip",
        orchestrator: { systemPrompt: "t" },
        routines: [
          {
            id: "main",
            params: [],
            steps: [
              {
                type: "loop",
                id: "build_loop",
                maxIterations: 3,
                steps: [{ type: "shell", id: "inner", command: "echo hi", cwd: "/tmp" }],
              },
              {
                type: "loop",
                id: "test_loop",
                maxIterations: 3,
                steps: [{ type: "shell", id: "inner2", command: "echo hi", cwd: "/tmp" }],
              },
            ],
          },
        ],
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());

      const result = await executor.run("main", {}, "task");

      expect(result.status).toBe("skipped");
      expect(result.reason).toBe("Skipped step(s): build_loop, test_loop");
    });

    it('reports "failed" when a step reports passed:false, even if another step was skipped', async () => {
      const registry = new StepExecutorRegistry();
      registry.register(() => new SkippedLoopExecutorStub());
      registry.register(() => new SoftFailingShellExecutor());

      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "skip-fail-flow",
        command: "/skip-fail",
        orchestrator: { systemPrompt: "t" },
        routines: [
          {
            id: "main",
            params: [],
            steps: [
              {
                type: "loop",
                id: "build_loop",
                maxIterations: 3,
                steps: [{ type: "shell", id: "inner", command: "echo hi", cwd: "/tmp" }],
              },
              { type: "shell", id: "sync", command: "git fetch", cwd: "/tmp" },
            ],
          },
        ],
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());

      const result = await executor.run("main", {}, "task");

      expect(result.passed).toBe(false);
      expect(result.status).toBe("failed");
      expect(result.reason).toBeUndefined();
    });

    it("does not classify raw text mentioning skipped:true as a skipped step", async () => {
      const registry = new StepExecutorRegistry();
      registry.register(
        () =>
          new (class extends StepExecutor {
            readonly type = "shell";
            async execute(
              instruction: FlowInstruction,
              context: FlowContext,
            ): Promise<FlowContext> {
              return context.withResult(instruction.id, {
                raw: 'echo "skipped":true in output',
                parsed: { passed: true, summary: "done" },
              });
            }
          })(),
      );

      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "raw-skip-text-flow",
        command: "/raw-skip-text",
        orchestrator: { systemPrompt: "t" },
        routines: [
          {
            id: "main",
            params: [],
            steps: [{ type: "shell", id: "echo", command: "echo hi", cwd: "/tmp" }],
          },
        ],
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());

      const result = await executor.run("main", {}, "task");

      // Raw text mentioning the marker is not a structural skip.
      expect(result.passed).toBe(true);
      expect(result.status).toBe("success");
      expect(result.reason).toBeUndefined();
    });

    it('reports "failed" when a step throws', async () => {
      const registry = new StepExecutorRegistry();
      registry.register(() => new FailingExecutor());

      const flow: FlowDefinition = {
        $schema: FLOW_SCHEMA_URL,
        name: "fail-flow",
        command: "/fail",
        orchestrator: { systemPrompt: "t" },
        routines: [
          {
            id: "main",
            params: [],
            steps: [{ type: "fail", id: "f1" } as unknown as FlowInstruction],
          },
        ],
      };

      const eventBus = makeMockTypedEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus, makeMockToolRegistry());

      const result = await executor.run("main", {}, "task");

      expect(result.passed).toBe(false);
      expect(result.status).toBe("failed");
    });
  });
});
