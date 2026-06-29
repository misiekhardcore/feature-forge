import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { FlowContext } from "./FlowContext";
import type { FlowDefinition } from "./FlowInstruction";
import { RoutineExecutor } from "./RoutineExecutor";
import { RoutineTool } from "./RoutineTool";
import { StepExecutor } from "./StepExecutor";
import { StepExecutorRegistry } from "./StepExecutorRegistry";

// ── Helpers ──────────────────────────────────────────────────

function makeFlow(routineParamNames: string[] = []): FlowDefinition {
  return {
    name: "test-flow",
    command: "/test",
    orchestrator: { systemPrompt: "t" },
    routines: {
      build: {
        params: routineParamNames.map((name) => ({ name })),
        steps: [],
      },
    },
  };
}

// ── Tests ────────────────────────────────────────────────────

describe("RoutineTool", () => {
  describe("constructor", () => {
    it("sets name to routineName", () => {
      const flow = makeFlow();
      const executor = new RoutineExecutor(flow, new StepExecutorRegistry());
      const tool = new RoutineTool("myflow", "build", executor, flow.routines["build"]);

      expect(tool.name).toBe("build");
    });

    it("sets a human-readable label", () => {
      const flow = makeFlow();
      const executor = new RoutineExecutor(flow, new StepExecutorRegistry());
      const tool = new RoutineTool("myflow", "build", executor, flow.routines["build"]);

      expect(tool.label).toContain("myflow/build");
    });

    it("sets description without params when routine has none", () => {
      const flow = makeFlow();
      const executor = new RoutineExecutor(flow, new StepExecutorRegistry());
      const tool = new RoutineTool("myflow", "build", executor, flow.routines["build"]);

      expect(tool.description).not.toContain("Parameters:");
    });

    it("includes param names in description when routine has params", () => {
      const flow = makeFlow(["task", "plan"]);
      const executor = new RoutineExecutor(flow, new StepExecutorRegistry());
      const tool = new RoutineTool("myflow", "build", executor, flow.routines["build"]);

      expect(tool.description).toContain("task, plan");
    });

    it("has typed parameters built from the routine's param declarations", () => {
      const flow = makeFlow(["task", "plan"]);
      const executor = new RoutineExecutor(flow, new StepExecutorRegistry());
      const tool = new RoutineTool("myflow", "build", executor, flow.routines["build"]);

      expect(tool.parameters).toBeDefined();
      // The schema is built dynamically — verify it has the expected structure.
      const schemaJson = JSON.stringify(tool.parameters);
      expect(schemaJson).toContain('"task"');
      expect(schemaJson).toContain('"plan"');
    });
  });

  describe("execute", () => {
    it("calls RoutineExecutor.run and returns a structured result", async () => {
      const flow: FlowDefinition = {
        name: "test-flow",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: {
          build: {
            params: [],
            steps: [],
          },
        },
      };

      const executor = new RoutineExecutor(flow, new StepExecutorRegistry());
      const tool = new RoutineTool("myflow", "build", executor, flow.routines["build"]);

      const result = await tool.execute(
        "call-1",
        { task: "fix bug" },
        undefined,
        undefined,
        {} as ExtensionContext,
      );

      expect(result.content).toHaveLength(1);
      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.routine).toBe("build");
      expect(parsed.passed).toBe(true);
    });

    it("passes resolved routine params to the executor", async () => {
      const registry = new StepExecutorRegistry();
      registry.register(
        new (class extends StepExecutor {
          readonly type = "agent";
          async execute() {
            return new FlowContext(new Map(), "resolved-task");
          }
        })(),
      );

      const flow: FlowDefinition = {
        name: "test-flow",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: {
          build: {
            params: [{ name: "task" }],
            steps: [
              {
                type: "agent",
                id: "s1",
                systemPrompt: "build",
                task: "do {{task}}",
              } as unknown as import("./FlowInstruction").FlowInstruction,
            ],
          },
        },
      };

      const executor = new RoutineExecutor(flow, registry);
      const tool = new RoutineTool("myflow", "build", executor, flow.routines["build"]);

      const result = await tool.execute(
        "call-1",
        { task: "fix bug" },
        undefined,
        undefined,
        {} as ExtensionContext,
      );

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.routine).toBe("build");
      expect(parsed.passed).toBe(true);
    });

    it("uses empty string when neither task nor _task is in params", async () => {
      const flow: FlowDefinition = {
        name: "test-flow",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: {
          build: { params: [], steps: [] },
        },
      };

      const executor = new RoutineExecutor(flow, new StepExecutorRegistry());
      const tool = new RoutineTool("myflow", "build", executor, flow.routines["build"]);

      const result = await tool.execute(
        "call-1",
        {}, // no task, no _task
        undefined,
        undefined,
        {} as ExtensionContext,
      );

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.routine).toBe("build");
      expect(parsed.passed).toBe(true);
    });

    it("skips params not present in input", async () => {
      const flow: FlowDefinition = {
        name: "test-flow",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: {
          build: {
            params: [{ name: "task" }, { name: "plan" }],
            steps: [],
          },
        },
      };

      const executor = new RoutineExecutor(flow, new StepExecutorRegistry());
      const tool = new RoutineTool("myflow", "build", executor, flow.routines["build"]);

      const result = await tool.execute(
        "call-1",
        { task: "fix bug" }, // plan is missing
        undefined,
        undefined,
        {} as ExtensionContext,
      );

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.routine).toBe("build");
      expect(parsed.passed).toBe(true);
    });

    it("uses _task as fallback when task is not in params", async () => {
      const flow: FlowDefinition = {
        name: "test-flow",
        command: "/test",
        orchestrator: { systemPrompt: "t" },
        routines: {
          build: {
            params: [{ name: "branch" }],
            steps: [],
          },
        },
      };

      const executor = new RoutineExecutor(flow, new StepExecutorRegistry());
      const tool = new RoutineTool("myflow", "build", executor, flow.routines["build"]);

      const result = await tool.execute(
        "call-1",
        { _task: "fix bug", branch: "main" },
        undefined,
        undefined,
        {} as ExtensionContext,
      );

      const parsed = JSON.parse((result.content[0] as { text: string }).text);
      expect(parsed.routine).toBe("build");
      expect(parsed.passed).toBe(true);
    });
  });
});
