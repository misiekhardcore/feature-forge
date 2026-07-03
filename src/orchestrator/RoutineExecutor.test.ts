import { describe, expect, it, vi } from "vitest";

import { WorkspaceHandle } from "../workspace/WorkspaceHandle";
import { FlowContext } from "./FlowContext";
import type { FlowDefinition, FlowInstruction } from "./FlowInstruction";
import { RoutineExecutor } from "./RoutineExecutor";
import type { RoutineProgress, RoutineProgressEvent } from "./RoutineProgress";
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
    _onProgress: RoutineProgress,
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
    _onProgress: RoutineProgress,
  ): Promise<FlowContext> {
    throw new Error(`step ${instruction.id} failed intentionally`);
  }
}

function makeTestFlow(overrides: Partial<FlowDefinition["routines"]["_"]> = {}): FlowDefinition {
  return {
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
      const executor = new RoutineExecutor(flow, registry);

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
      const executor = new RoutineExecutor(flow, registry);

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

      const executor = new RoutineExecutor(flow, registry);
      const result = await executor.run("main", {}, "task");
      expect(result.workspace).toBe("/tmp/forge-worktree");
    });

    it("returns a failure result when a step throws", async () => {
      const registry = new StepExecutorRegistry();
      registry.register(() => new FailingExecutor());
      registry.register(() => new RecordExecutor()); // won't run

      const flow: FlowDefinition = {
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

      const executor = new RoutineExecutor(flow, registry);
      const result = await executor.run("main", {}, "task");

      expect(result.passed).toBe(false);
      expect(result.summary).toContain("failed");
      expect(result.summary).toContain("step f1 failed intentionally");
      // The result for f1 is not recorded because it threw.
    });

    it("throws for an unknown routine name", async () => {
      const registry = new StepExecutorRegistry();
      const flow = makeTestFlow();
      const executor = new RoutineExecutor(flow, registry);

      await expect(executor.run("nonexistent", {}, "task")).rejects.toThrow(
        'Routine "nonexistent" not found',
      );
    });

    it("returns a failure result for an unknown step type", async () => {
      const registry = new StepExecutorRegistry();
      // No "record" executor registered.
      const flow = makeTestFlow();
      const executor = new RoutineExecutor(flow, registry);

      const result = await executor.run("main", {}, "task");

      expect(result.passed).toBe(false);
      expect(result.summary).toContain('No step executor registered for type "record"');
    });

    it("threads onProgress to step executors", async () => {
      RecordExecutor.reset();
      const registry = new StepExecutorRegistry();

      // Create a custom executor that forwards onProgress to prove threading.
      class ProgressAwareExecutor extends StepExecutor {
        readonly type = "progress-aware";
        async execute(
          instruction: FlowInstruction,
          context: FlowContext,
          _executeStep: (
            instruction: FlowInstruction,
            context: FlowContext,
          ) => Promise<FlowContext>,
          onProgress: RoutineProgress,
        ): Promise<FlowContext> {
          onProgress({
            phase: "custom-event",
            message: `step ${instruction.id}`,
            details: {},
          });
          return context.withResult(instruction.id, { raw: `done:${instruction.id}` });
        }
      }

      registry.register(() => new ProgressAwareExecutor());

      const flow: FlowDefinition = {
        name: "progress-flow",
        command: "/progress",
        orchestrator: { systemPrompt: "t" },
        routines: {
          main: {
            params: [],
            steps: [
              { type: "progress-aware", id: "step1" } as unknown as FlowInstruction,
              { type: "progress-aware", id: "step2" } as unknown as FlowInstruction,
            ],
          },
        },
      };

      const executor = new RoutineExecutor(flow, registry);
      const events: RoutineProgressEvent[] = [];

      const result = await executor.run("main", {}, "task", (e) => events.push(e));

      expect(result.passed).toBe(true);
      expect(events).toHaveLength(2);
      expect(events[0].phase).toBe("custom-event");
      expect(events[0].message).toContain("step1");
      expect(events[1].phase).toBe("custom-event");
      expect(events[1].message).toContain("step2");
    });

    it("works without onProgress (optional parameter)", async () => {
      RecordExecutor.reset();
      const registry = new StepExecutorRegistry();
      registry.register(() => new RecordExecutor());

      const flow = makeTestFlow();
      const executor = new RoutineExecutor(flow, registry);

      // Should work when onProgress is omitted.
      const result = await executor.run("main", {}, "task");

      expect(result.passed).toBe(true);
    });

    it("emits progress events to eventBus when provided", async () => {
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
          onProgress: RoutineProgress,
        ): Promise<FlowContext> {
          onProgress({
            phase: "agent-started",
            message: `launching ${instruction.id}`,
            details: { routine: "main" },
          });
          return context.withResult(instruction.id, { raw: `done:${instruction.id}` });
        }
      }

      registry.register(() => new EventBusAwareExecutor());

      const flow: FlowDefinition = {
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

    it("includes available routines in the unknown routine error", async () => {
      const registry = new StepExecutorRegistry();
      const flow: FlowDefinition = {
        name: "multi",
        command: "/multi",
        orchestrator: { systemPrompt: "t" },
        routines: {
          alpha: { params: [], steps: [] },
          beta: { params: [], steps: [] },
        },
      };

      const executor = new RoutineExecutor(flow, registry);
      await expect(executor.run("gamma", {}, "task")).rejects.toThrow("alpha, beta");
    });
  });
});
