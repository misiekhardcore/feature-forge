import type { EventBus } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import { makeMockEventBus } from "../test-utils";
import { WorkspaceHandle } from "../workspace/WorkspaceHandle";
import { FlowContext } from "./FlowContext";
import type { FlowDefinition, FlowInstruction } from "./FlowInstruction";
import { FLOW_SCHEMA_URL } from "./FlowInstruction";
import { RoutineExecutor } from "./RoutineExecutor";
import { StepExecutor } from "./StepExecutor";
import { StepExecutorRegistry } from "./StepExecutorRegistry";

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

function makeTestFlow(overrides: Partial<FlowDefinition["routines"]["_"]> = {}): FlowDefinition {
  return {
    $schema: FLOW_SCHEMA_URL,
    name: "test-flow",
    command: "/test",
    orchestrator: { systemPrompt: "You are the test orchestrator." },
    routines: {
      main: {
        params: [{ name: "task" }],
        steps: [
          { type: "record", id: "step1" },
          {
            type: "record",
            id: "step2",
            systemPrompt: "build",
            task: "do {{prompt}} with {{plan}}",
          },
          ...(overrides.steps ?? []),
        ],
        ...overrides,
      },
    },
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
      const eventBus = makeMockEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus);

      const result = await executor.run("main", { plan: "use JWT" }, "add auth");

      expect(result.passed).toBe(true);
      expect(result.routine).toBe("main");
      expect(result.rounds).toBe(1);
      expect(result.summary).toContain("completed");

      // Steps executed in order.
      expect(RecordExecutor.executed).toHaveLength(2);
      expect(RecordExecutor.executed[0].id).toBe("step1");
      expect(RecordExecutor.executed[1].id).toBe("step2");

      // Template resolution applied.
      expect(RecordExecutor.executed[1].task).toBe("do add auth with use JWT");
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
      const eventBus = makeMockEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus);

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
        routines: {
          main: {
            params: [],
            steps: [{ type: "ws", id: "myws" } as unknown as FlowInstruction],
          },
        },
      };

      const eventBus = makeMockEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus);
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
        routines: {
          main: {
            params: [],
            steps: [
              { type: "fail", id: "f1" } as unknown as FlowInstruction,
              { type: "record", id: "after" } as unknown as FlowInstruction,
            ],
          },
        },
      };

      const eventBus = makeMockEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus);
      const result = await executor.run("main", {}, "task");

      expect(result.passed).toBe(false);
      expect(result.summary).toContain("failed");
      expect(result.summary).toContain("step f1 failed intentionally");
    });

    it("throws for an unknown routine name", async () => {
      const registry = new StepExecutorRegistry();
      const flow = makeTestFlow();
      const eventBus = makeMockEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus);

      await expect(executor.run("nonexistent", {}, "task")).rejects.toThrow(
        'Routine "nonexistent" not found',
      );
    });

    it("returns a failure result for an unknown step type", async () => {
      const registry = new StepExecutorRegistry();
      // No "record" executor registered.
      const flow = makeTestFlow();
      const eventBus = makeMockEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus);

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
        routines: {
          main: {
            params: [],
            steps: [
              { type: "event-bus-aware", id: "step1" } as unknown as FlowInstruction,
              { type: "event-bus-aware", id: "step2" } as unknown as FlowInstruction,
            ],
          },
        },
      };

      const emitSpy = vi.fn();
      const eventBus = { emit: emitSpy, on: vi.fn() };

      const executor = new RoutineExecutor(flow, registry, eventBus);
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
      const eventBus = makeMockEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus);

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
        routines: {
          main: {
            params: [],
            steps: [{ type: "event-bus-aware", id: "step1" } as unknown as FlowInstruction],
          },
        },
      };

      const emitSpy = vi.fn();
      const eventBus = { emit: emitSpy, on: vi.fn() };

      const executor = new RoutineExecutor(flow, registry, eventBus);
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
        routines: {
          main: {
            params: [],
            steps: [{ type: "signal-aware", id: "step1" } as unknown as FlowInstruction],
          },
        },
      };

      const eventBus = makeMockEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus);
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
      const eventBus = makeMockEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus);
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
        routines: {
          main: {
            params: [],
            steps: [{ type: "abort-during", id: "step1" } as unknown as FlowInstruction],
          },
        },
      };

      const eventBus = makeMockEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus);

      await expect(executor.run("main", {}, "task")).rejects.toThrow();
    });

    it("runs without a signal (backwards-compatible)", async () => {
      RecordExecutor.reset();
      const registry = new StepExecutorRegistry();
      registry.register(() => new RecordExecutor());

      const flow = makeTestFlow();
      const eventBus = makeMockEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus);

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
        routines: {
          alpha: { params: [], steps: [] },
          beta: { params: [], steps: [] },
        },
      };

      const eventBus = makeMockEventBus();
      const executor = new RoutineExecutor(flow, registry, eventBus);
      await expect(executor.run("gamma", {}, "task")).rejects.toThrow("alpha, beta");
    });
  });
});
