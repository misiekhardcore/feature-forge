import { describe, expect, it } from "vitest";

import { WorkspaceHandle } from "../../workspace/WorkspaceHandle";
import { FlowContext } from "../FlowContext";
import type { FlowInstruction, ParallelInstruction } from "../FlowInstruction";
import { StepExecutor } from "../StepExecutor";
import { StepExecutorRegistry } from "../StepExecutorRegistry";
import { ParallelStepExecutor } from "./ParallelStepExecutor";

// Build a dispatch callback that delegates through a StepExecutorRegistry.
function makeDispatch(
  registry: StepExecutorRegistry,
): (instruction: FlowInstruction, context: FlowContext) => Promise<FlowContext> {
  const dispatch = async (instruction: FlowInstruction, ctx: FlowContext): Promise<FlowContext> => {
    const executor = registry.get(instruction.type);
    if (!executor) {
      throw new Error(`No executor registered for step type "${instruction.type}"`);
    }
    return executor.execute(instruction, ctx, dispatch);
  };
  return dispatch;
}

// ── Helpers ──────────────────────────────────────────────────

class ConfigurableExecutor extends StepExecutor {
  readonly type: string;

  constructor(
    type: string,
    private readonly output: string,
  ) {
    super();
    this.type = type;
  }

  async execute(instruction: FlowInstruction, context: FlowContext): Promise<FlowContext> {
    return context.withResult(instruction.id, { raw: this.output });
  }
}

class DelayedExecutor extends StepExecutor {
  readonly type = "delayed";

  constructor(private readonly delayMs: number) {
    super();
  }

  async execute(instruction: FlowInstruction, context: FlowContext): Promise<FlowContext> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return context.withResult(instruction.id, { raw: `delayed-${instruction.id}` });
  }
}

class FailingExecutor extends StepExecutor {
  readonly type = "failing";

  async execute(instruction: FlowInstruction, _context: FlowContext): Promise<FlowContext> {
    throw new Error(`step ${instruction.id} failed`);
  }
}

class WorkspaceCreatingExecutor extends StepExecutor {
  readonly type = "workspace-creator";

  async execute(instruction: FlowInstruction, context: FlowContext): Promise<FlowContext> {
    const handle = new WorkspaceHandle(instruction.id, `/ws/${instruction.id}`, new Date());
    return context.withWorkspace(instruction.id, handle).withResult(instruction.id, {
      raw: `created ${instruction.id}`,
    });
  }
}

// ── Tests ────────────────────────────────────────────────────

describe("ParallelStepExecutor", () => {
  it("executes all children and aggregates their results", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(new ConfigurableExecutor("op-a", "child-a-out"));
    registry.register(new ConfigurableExecutor("op-b", "child-b-out"));

    const executor = new ParallelStepExecutor();

    const instruction: ParallelInstruction = {
      type: "parallel",
      id: "block",
      steps: [
        { type: "op-a", id: "a" } as unknown as FlowInstruction,
        { type: "op-b", id: "b" } as unknown as FlowInstruction,
      ],
    };

    const context = new FlowContext(new Map(), "task");
    const executeStep = makeDispatch(registry);
    const result = await executor.execute(instruction, context, executeStep);

    expect(result.results.get("a")!.raw).toBe("child-a-out");
    expect(result.results.get("b")!.raw).toBe("child-b-out");
    expect(result.results.get("block")!.parsed!.passed).toBe(true);
  });

  it("merges workspaces from child results", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(new WorkspaceCreatingExecutor());

    const executor = new ParallelStepExecutor();

    const instruction: ParallelInstruction = {
      type: "parallel",
      id: "block",
      steps: [
        { type: "workspace-creator", id: "ws1" } as unknown as FlowInstruction,
        { type: "workspace-creator", id: "ws2" } as unknown as FlowInstruction,
      ],
    };

    const context = new FlowContext(new Map(), "task");
    const executeStep = makeDispatch(registry);
    const result = await executor.execute(instruction, context, executeStep);

    expect(result.workspaces.has("ws1")).toBe(true);
    expect(result.workspaces.has("ws2")).toBe(true);
  });

  it("propagates the first error after all children settle", async () => {
    const registry = new StepExecutorRegistry();
    registry.register(new DelayedExecutor(10));
    registry.register(new FailingExecutor());

    const executor = new ParallelStepExecutor();

    const instruction: ParallelInstruction = {
      type: "parallel",
      id: "block",
      steps: [
        { type: "delayed", id: "a" } as unknown as FlowInstruction,
        { type: "failing", id: "b" } as unknown as FlowInstruction,
      ],
    };

    const context = new FlowContext(new Map(), "task");

    await expect(executor.execute(instruction, context, makeDispatch(registry))).rejects.toThrow(
      "step b failed",
    );
  });

  it("throws for an unknown step type in children", async () => {
    const registry = new StepExecutorRegistry();
    const executor = new ParallelStepExecutor();

    const instruction: ParallelInstruction = {
      type: "parallel",
      id: "block",
      steps: [{ type: "unknown", id: "x" } as unknown as FlowInstruction],
    };

    const context = new FlowContext(new Map(), "task");

    await expect(executor.execute(instruction, context, makeDispatch(registry))).rejects.toThrow(
      'No executor registered for step type "unknown"',
    );
  });

  it("handles an empty block (no children)", async () => {
    const registry = new StepExecutorRegistry();
    const executor = new ParallelStepExecutor();

    const instruction: ParallelInstruction = {
      type: "parallel",
      id: "empty",
      steps: [],
    };

    const context = new FlowContext(new Map(), "task");
    const executeStep = makeDispatch(registry);
    const result = await executor.execute(instruction, context, executeStep);

    expect(result.results.get("empty")!.parsed!.passed).toBe(true);
  });
});
