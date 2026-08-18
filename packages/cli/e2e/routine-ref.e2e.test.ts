/**
 * E2E test for cross-flow routine references with inline flattening.
 *
 * Exercises the full RoutineExecutor cycle with a parent flow that
 * references a sub-flow via type: "routine" — steps are inlined,
 * name: "output_as".
 *
 * Run via: `npm run test:e2e`
 */

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryAgentSupervisor } from "@feature-forge/core/src/agents";
import { describe, expect, it } from "vitest";

import {
  createStepExecutorRegistry,
  FLOW_SCHEMA_URL,
  type FlowDefinition,
  type FlowInstruction,
  RoutineExecutor,
  type RoutineProgressEvent,
} from "../src/orchestrator";
import {
  makeMockFactory,
  makeMockSpecManager,
  makeMockToolRegistry,
  makeMockTypedEventBus,
} from "../src/test-utils";
import { MockWorkspaceProvider, MockWorktreeRegistry } from "../src/test-utils";
import { WorkspaceProviderRegistry, WorktreeRegistry } from "../src/workspace";
import { WorkspaceManager } from "../src/workspace/WorkspaceManager";

// ── Helpers ──────────────────────────────────────────────────

function makeChildFlow(
  name: string,
  command: string,
  routines: FlowDefinition["routines"],
): FlowDefinition {
  return {
    $schema: FLOW_SCHEMA_URL,
    name,
    command,
    orchestrator: { systemPrompt: `${name}-orchestrator` },
    routines,
  };
}

function agentStep(
  id: string,
  systemPrompt: string,
  workingDir: { path: string } | undefined,
  prompt: string,
): FlowInstruction {
  return {
    type: "agent",
    id,
    systemPrompt,
    ...(workingDir ? { workingDir } : {}),
    parseJson: false,
    prompt,
  };
}

function tmpRegistryPath(): string {
  return join(tmpdir(), `forge-e2e-ref-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

// ── Tests ────────────────────────────────────────────────────

describe("routine ref inline flattening (e2e)", () => {
  it("inlines sub-flow steps and produces namespaced results", async () => {
    const childFlow = makeChildFlow("review", "/review", [
      {
        id: "inspect",
        params: [{ name: "changes" }, { name: "workspace", description: "Workspace path" }],
        steps: [
          agentStep(
            "review",
            "review",
            { path: "{{workspace}}" },
            "Review: {{prompt}}\n\nOutput: {{output}}",
          ),
        ],
      },
    ]);

    const parentFlow = makeChildFlow("implement", "/implement", [
      {
        id: "run_build_loop",
        params: [{ name: "workspace" }, { name: "task" }, { name: "plan" }],
        steps: [
          agentStep(
            "builder",
            "build",
            { path: "{{workspace}}" },
            "Build: {{prompt}}\n\nPlan: {{plan}}",
          ),
          {
            type: "routine",
            id: "call_review",
            target: "review",
            output_as: "call_review",
            input: { changes: "{{results.builder.raw}}", workspace: "{{workspace}}" },
          },
        ],
      },
    ]);

    const executor = setupExecutor(parentFlow, [childFlow]);

    const result = await executor.run(
      "run_build_loop",
      { workspace: "/tmp/ws", task: "fix bug", plan: "add tests" },
      "Fix crash",
    );

    expect(result.passed).toBe(true);

    // Routine ref result stored under output_as key.
    expect(result.results.call_review).toBeDefined();

    // Namespaced inlined step ID: {instructionId}.{flowName}.{stepId}
    const namespacedKey = "call_review.review.review";
    expect(result.results[namespacedKey]).toBeDefined();

    // Parent's own step result under its un-namespaced ID.
    expect(result.results.builder).toBeDefined();
  });

  it("emits routine-ref events during inline flattening", async () => {
    const childFlow = makeChildFlow("review", "/review", [
      {
        id: "inspect",
        params: [{ name: "workspace" }],
        steps: [agentStep("review", "review", { path: "{{workspace}}" }, "Review: {{prompt}}")],
      },
    ]);

    const parentFlow = makeChildFlow("implement", "/implement", [
      {
        id: "run_build_loop",
        params: [{ name: "workspace" }],
        steps: [
          agentStep("builder", "build", { path: "{{workspace}}" }, "Build"),
          {
            type: "routine",
            id: "call_review",
            target: "review",
            output_as: "call_review",
            input: { workspace: "{{workspace}}" },
          },
        ],
      },
    ]);

    const executor = setupExecutor(parentFlow, [childFlow]);

    const events: RoutineProgressEvent[] = [];
    executor.eventBus.on("feature-forge:routine-ref-start", (e: RoutineProgressEvent) =>
      events.push(e),
    );
    executor.eventBus.on("feature-forge:routine-ref-done", (e: RoutineProgressEvent) =>
      events.push(e),
    );
    executor.eventBus.on("feature-forge:agent-started", (e: RoutineProgressEvent) =>
      events.push(e),
    );
    executor.eventBus.on("feature-forge:agent-done", (e: RoutineProgressEvent) => events.push(e));

    await executor.run("run_build_loop", { workspace: "/tmp/ws" }, "Test events");

    const refStarts = events.filter((e) => e.phase === "routine-ref-start");
    const refDones = events.filter((e) => e.phase === "routine-ref-done");
    expect(refStarts.length).toBeGreaterThanOrEqual(1);
    expect(refDones.length).toBeGreaterThanOrEqual(1);
    expect(refStarts[0].message).toContain("call_review");

    // Agent events fire for steps in both parent and inlined flows.
    const agentStarts = events.filter((e) => e.phase === "agent-started");
    expect(agentStarts.length).toBeGreaterThanOrEqual(2);
  });

  it("inlines multiple routine refs to different target flows", async () => {
    const reviewFlow = makeChildFlow("review", "/review", [
      {
        id: "inspect",
        params: [{ name: "changes" }, { name: "workspace" }],
        steps: [agentStep("review", "review", { path: "{{workspace}}" }, "Review: {{output}}")],
      },
    ]);

    const verifyFlow = makeChildFlow("verify", "/verify", [
      {
        id: "check",
        params: [{ name: "changes" }, { name: "workspace" }],
        steps: [agentStep("verify", "verify", { path: "{{workspace}}" }, "Verify: {{output}}")],
      },
    ]);

    const parentFlow = makeChildFlow("implement", "/implement", [
      {
        id: "run_all",
        params: [],
        steps: [
          {
            type: "routine",
            id: "call_review",
            target: "review",
            output_as: "review_out",
            input: { changes: "n/a", workspace: "/tmp/ws" },
          },
          {
            type: "routine",
            id: "call_verify",
            target: "verify",
            output_as: "verify_out",
            input: { changes: "n/a", workspace: "/tmp/ws" },
          },
        ],
      },
    ]);

    const executor = setupExecutor(parentFlow, [reviewFlow, verifyFlow]);

    const result = await executor.run("run_all", {}, "Multi ref");

    expect(result.passed).toBe(true);
    expect(result.results.review_out).toBeDefined();
    expect(result.results.verify_out).toBeDefined();
  });

  it("records namespaced step IDs for all inlined steps", async () => {
    const childFlow = makeChildFlow("review", "/review", [
      {
        id: "inspect",
        params: [{ name: "workspace" }],
        steps: [agentStep("review", "review", { path: "{{workspace}}" }, "Review")],
      },
    ]);

    const parentFlow = makeChildFlow("implement", "/implement", [
      {
        id: "run_build_loop",
        params: [{ name: "workspace" }],
        steps: [
          agentStep("builder", "build", { path: "{{workspace}}" }, "Build"),
          {
            type: "routine",
            id: "call_review",
            target: "review",
            output_as: "call_review",
            input: { workspace: "{{workspace}}" },
          },
        ],
      },
    ]);

    const executor = setupExecutor(parentFlow, [childFlow]);

    const result = await executor.run(
      "run_build_loop",
      { workspace: "/tmp/ws" },
      "Namespacing test",
    );

    const keys = Object.keys(result.results);
    // Parent's own step.
    expect(keys).toContain("builder");
    // output_as key — the routine ref's aggregated result.
    expect(keys).toContain("call_review");
    // Namespaced inlined step: {instructionId}.{flowName}.{stepId}
    expect(keys).toContain("call_review.review.review");
  });

  it("merges input params so sub-flow steps receive them", async () => {
    const childFlow = makeChildFlow("review", "/review", [
      {
        id: "inspect",
        params: [{ name: "changes" }, { name: "workspace" }],
        steps: [
          agentStep("review", "review", { path: "{{workspace}}" }, "Review output: {{output}}"),
        ],
      },
    ]);

    const parentFlow = makeChildFlow("implement", "/implement", [
      {
        id: "run_build_loop",
        params: [{ name: "workspace" }],
        steps: [
          agentStep("builder", "build", { path: "{{workspace}}" }, "Build"),
          {
            type: "routine",
            id: "call_review",
            target: "review",
            output_as: "call_review",
            input: { changes: "{{results.builder.raw}}", workspace: "{{workspace}}" },
          },
        ],
      },
    ]);

    const executor = setupExecutor(parentFlow, [childFlow]);

    const result = await executor.run(
      "run_build_loop",
      { workspace: "/tmp/ws", task: "task", plan: "plan" },
      "Param merge test",
    );

    // Both parent and child steps pass — input params are available to sub-flow.
    expect(result.passed).toBe(true);
    expect(result.results.call_review).toBeDefined();
  });

  it("inlines only the matching routine for flow.routine targets", async () => {
    const multiFlow = makeChildFlow("multi", "/multi", [
      {
        id: "inspect",
        params: [{ name: "changes" }, { name: "workspace" }],
        steps: [
          agentStep("inspect_step", "inspect", { path: "{{workspace}}" }, "Inspect: {{output}}"),
        ],
      },
      {
        id: "check",
        params: [{ name: "changes" }, { name: "workspace" }],
        steps: [agentStep("check_step", "check", { path: "{{workspace}}" }, "Check: {{output}}")],
      },
    ]);

    const parentFlow = makeChildFlow("implement", "/implement", [
      {
        id: "run",
        params: [],
        steps: [
          {
            type: "routine",
            id: "call_check",
            target: "multi.check",
            output_as: "call_check",
            input: { changes: "n/a", workspace: "/tmp/ws" },
          },
        ],
      },
    ]);

    const executor = setupExecutor(parentFlow, [multiFlow]);

    const result = await executor.run("run", {}, "Dot notation test");

    expect(result.passed).toBe(true);

    // Only the "check" routine inlines — its step is namespaced under the
    // routine-ref instruction id + full dotted target.
    const namespacedKey = "call_check.multi.check.check_step";
    expect(result.results[namespacedKey]).toBeDefined();

    // The "inspect" routine must NOT be inlined.
    expect(result.results["call_check.multi.check.inspect_step"]).toBeUndefined();

    // The routine-ref result reports the filtered routineCount.
    const refResult = result.results.call_check;
    expect(refResult).toBeDefined();
    const raw = JSON.parse(refResult.raw) as {
      routineCount: number;
      routines: string[];
    };
    expect(raw.routineCount).toBe(1);
    expect(raw.routines).toEqual(["check"]);
  });

  it("returns failure result for unknown routine in flow.routine target", async () => {
    const multiFlow = makeChildFlow("multi", "/multi", [
      {
        id: "inspect",
        params: [],
        steps: [agentStep("inspect_step", "inspect", undefined, "Inspect")],
      },
    ]);

    const parentFlow = makeChildFlow("implement", "/implement", [
      {
        id: "run",
        params: [],
        steps: [
          {
            type: "routine",
            id: "call_missing",
            target: "multi.nonexistent",
            output_as: "out",
          },
        ],
      },
    ]);

    const executor = setupExecutor(parentFlow, [multiFlow]);

    const result = await executor.run("run", {}, "Test");

    // RoutineExecutor converts step-level errors to failure results,
    // so we check the summary rather than expecting a throw.
    expect(result.passed).toBe(false);
    expect(result.summary).toContain('Unknown routine "nonexistent" in flow "multi"');
  });

  it("returns failure result for malformed flow.routine targets", async () => {
    const multiFlow = makeChildFlow("multi", "/multi", [
      {
        id: "inspect",
        params: [],
        steps: [agentStep("inspect_step", "inspect", undefined, "Inspect")],
      },
    ]);

    const parentFlow = makeChildFlow("implement", "/implement", [
      {
        id: "run",
        params: [],
        steps: [
          {
            type: "routine",
            id: "call_bad",
            target: "multi.inspect.extra",
            output_as: "out",
          },
        ],
      },
    ]);

    const executor = setupExecutor(parentFlow, [multiFlow]);

    const result = await executor.run("run", {}, "Test");

    // Multi-segment targets are rejected instead of silently truncated.
    expect(result.passed).toBe(false);
    expect(result.summary).toContain('Malformed routine ref target "multi.inspect.extra"');
  });

  it("returns failure result for unknown target flow", async () => {
    const parentFlow = makeChildFlow("implement", "/implement", [
      {
        id: "run",
        params: [],
        steps: [{ type: "routine", id: "call_missing", target: "nonexistent", output_as: "out" }],
      },
    ]);

    const executor = setupExecutor(parentFlow, []);

    const result = await executor.run("run", {}, "Test");

    // RoutineExecutor converts step-level errors to failure results,
    // so we check the summary rather than expecting a throw.
    expect(result.passed).toBe(false);
    expect(result.summary).toContain("nonexistent");
  });
});

// ── Test infrastructure ──────────────────────────────────────

function setupExecutor(parentFlow: FlowDefinition, childFlows: FlowDefinition[]): RoutineExecutor {
  const registryPath = tmpRegistryPath();
  const worktreeRegistry = new WorktreeRegistry(registryPath);
  const wpRegistry = new WorkspaceProviderRegistry();
  const supervisor = new InMemoryAgentSupervisor(makeMockFactory());
  const stepRegistry = createStepExecutorRegistry(
    wpRegistry,
    supervisor,
    makeMockSpecManager(),
    worktreeRegistry,
    new WorkspaceManager(new MockWorkspaceProvider(), new MockWorktreeRegistry()),
  );

  const flowMap = new Map<string, FlowDefinition>();
  flowMap.set(parentFlow.name, parentFlow);
  for (const child of childFlows) {
    flowMap.set(child.name, child);
  }
  stepRegistry.setFlowMap(flowMap);

  // Clean up registry file after each test.
  try {
    rmSync(registryPath, { force: true });
  } catch {
    /* ignore */
  }

  return new RoutineExecutor(
    parentFlow,
    stepRegistry,
    makeMockTypedEventBus(),
    makeMockToolRegistry(),
  );
}
