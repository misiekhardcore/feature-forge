import { describe, expect, it } from "vitest";

import { FlowContext, type InstructionResult } from "./FlowContext";
import type { AgentInstruction, FlowDefinition, FlowInstruction } from "./FlowInstruction";
import { RoutineExecutor } from "./RoutineExecutor";
import { StepExecutor } from "./StepExecutor";
import { StepExecutorRegistry } from "./StepExecutorRegistry";

function makeFlow(overrides: Partial<FlowDefinition> = {}): FlowDefinition {
  return {
    name: "test-flow",
    command: "/test",
    orchestrator: { prompt: "orchestrator.md" },
    routines: {},
    ...overrides,
  } as FlowDefinition;
}

function makeRoutine(
  name: string,
  steps: FlowInstruction[],
  params: { name: string; description?: string }[] = [{ name: "task" }, { name: "plan" }],
): { name: string; params: { name: string; description?: string }[]; steps: FlowInstruction[] } {
  return { name, params, steps };
}

function makeAgentStep(id: string): AgentInstruction {
  return {
    type: "agent",
    id,
    spec: "build",
    task: `Task for ${id}`,
    parseJson: true,
  } as AgentInstruction;
}

class StubStepExecutor extends StepExecutor {
  readonly type: string;
  private readonly output: string;

  constructor(type: string, output = `result from ${type}`) {
    super();
    this.type = type;
    this.output = output;
  }

  override async execute(
    instruction: FlowInstruction,
    context: FlowContext,
    _executeStep: (instruction: FlowInstruction, context: FlowContext) => Promise<FlowContext>,
  ): Promise<FlowContext> {
    const result: InstructionResult = { raw: `${this.output} for ${instruction.id}` };
    return context.withResult(instruction.id, result);
  }
}

describe("RoutineExecutor", () => {
  describe("run", () => {
    it("executes all steps in a routine and returns a result", async () => {
      const routineName = "simple";
      const steps = [makeAgentStep("a1")];
      const flow = makeFlow({
        routines: { [routineName]: makeRoutine(routineName, steps) },
      });

      const registry = new StepExecutorRegistry();
      const stubAgent = new StubStepExecutor("agent", "agent-output");
      registry.register(stubAgent);

      const executor = new RoutineExecutor(flow, registry);
      const result = await executor.run(routineName, { task: "test task" });

      expect(result.routine).toBe(routineName);
      expect(result.passed).toBe(true);
      expect(result.results).toHaveProperty("a1");
      expect(result.results["a1"]!.raw).toContain("agent-output");
      expect(result.summary).toContain("passed");
    });

    it("reports passed: false when a parsed result is false", async () => {
      const routineName = "failing";
      const steps = [makeAgentStep("a1")];
      const flow = makeFlow({
        routines: { [routineName]: makeRoutine(routineName, steps) },
      });

      const registry = new StepExecutorRegistry();
      const failingExecutor = new (class extends StepExecutor {
        readonly type = "agent";
        override async execute(
          instruction: FlowInstruction,
          context: FlowContext,
        ): Promise<FlowContext> {
          return context.withResult(instruction.id, {
            raw: "failed",
            parsed: { kind: "build" as const, passed: false, summary: "nope" },
          });
        }
      })();
      registry.register(failingExecutor);

      const executor = new RoutineExecutor(flow, registry);
      const result = await executor.run(routineName, { task: "test" });

      expect(result.passed).toBe(false);
      expect(result.summary).toContain("failed");
    });

    it("throws when routine is not found", async () => {
      const flow = makeFlow();
      const registry = new StepExecutorRegistry();
      const executor = new RoutineExecutor(flow, registry);

      await expect(executor.run("nonexistent", {})).rejects.toThrow(
        'Routine "nonexistent" not found',
      );
    });

    it("throws when a step type has no registered executor", async () => {
      const routineName = "bad";
      const steps = [makeAgentStep("a1")];
      const flow = makeFlow({
        routines: { [routineName]: makeRoutine(routineName, steps) },
      });

      const registry = new StepExecutorRegistry();
      // No agent executor registered
      const executor = new RoutineExecutor(flow, registry);

      await expect(executor.run(routineName, { task: "test" })).rejects.toThrow(
        'No step executor registered for type: "agent"',
      );
    });

    it("tracks workspace in the result after a workspace step", async () => {
      const routineName = "with_workspace";
      const steps = [{ type: "workspace", id: "ws" } as unknown as FlowInstruction];
      const flow = makeFlow({
        routines: { [routineName]: makeRoutine(routineName, steps) },
      });

      const registry = new StepExecutorRegistry();
      const workspaceExecutor = new (class extends StepExecutor {
        readonly type = "workspace";
        override async execute(
          _instruction: FlowInstruction,
          context: FlowContext,
        ): Promise<FlowContext> {
          return context.withWorkspace("/tmp/ws-path", "ws");
        }
      })();
      registry.register(workspaceExecutor);

      const executor = new RoutineExecutor(flow, registry);
      const result = await executor.run(routineName, {});

      expect(result.workspace).toBe("/tmp/ws-path");
    });
  });

  describe("buildResult", () => {
    it("computes rounds from iteration counter", () => {
      const context = new FlowContext(new Map(), "task", "", undefined, undefined, undefined, 2);

      const result = RoutineExecutor.buildResult("test", { params: [], steps: [] }, context);

      expect(result.rounds).toBe(3);
    });

    it("leaves rounds undefined when iteration is 0", () => {
      const context = new FlowContext(new Map(), "task", "");

      const result = RoutineExecutor.buildResult("test", { params: [], steps: [] }, context);

      expect(result.rounds).toBeUndefined();
    });
  });
});
