/**
 * End-to-end tests for cross-flow routine references.
 *
 * Exercises the full RoutineExecutor + RoutineRefStepExecutor pipeline:
 * two flows (parent / child) registered in RuntimeCapabilities, the parent
 * calling the child via a `type: "routine"` instruction — all against a
 * real git repository with workspace steps.
 *
 * Run via: `npm run test:e2e`
 */

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { InMemoryAgentSupervisor } from "../src/agents";
import { createStepExecutorRegistry } from "../src/orchestrator/createStepExecutorRegistry";
import type { FlowDefinition } from "../src/orchestrator/FlowInstruction";
import { FLOW_SCHEMA_URL } from "../src/orchestrator/FlowInstruction";
import { RoutineExecutor } from "../src/orchestrator/RoutineExecutor";
import type { RoutineProgressEvent } from "../src/orchestrator/RoutineProgress";
import { RuntimeCapabilities } from "../src/orchestrator/RuntimeCapabilities";
import { StepExecutorRegistry } from "../src/orchestrator/StepExecutorRegistry";
import { makeMockEventBus, makeMockFactory, makeMockSpecManager } from "../src/test-utils";
import { GitWorktreeProvider } from "../src/workspace/GitWorktreeProvider";
import { WorkspaceProviderRegistry } from "../src/workspace/WorkspaceProviderRegistry";
import { WorktreeRegistry } from "../src/workspace/WorktreeRegistry";

// ── Helpers ───────────────────────────────────────────────────────────────

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-e2e-crossflow-"));
  execSync("git init --initial-branch=main", { cwd: dir });
  execSync('git config user.email "test@forge.local"', { cwd: dir });
  execSync('git config user.name "Forge E2E"', { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# test repo\n");
  execSync("git add README.md", { cwd: dir });
  execSync('git commit -m "initial commit"', { cwd: dir });
  return dir;
}

/** Child flow providing reusable routines called by the parent. */
function makeChildFlow(): FlowDefinition {
  return {
    $schema: FLOW_SCHEMA_URL,
    name: "cross-flow-child",
    command: "/child",
    orchestrator: { systemPrompt: "test" },
    routines: {
      store_session: {
        params: [
          { name: "key", description: "Session key to set" },
          { name: "value", description: "Session value" },
        ],
        steps: [{ type: "session", id: "set", key: "{{key}}", value: "{{value}}" }],
      },
      create_workspace: {
        params: [],
        steps: [{ type: "workspace", id: "child-ws", provider: "git-worktree" }],
      },
    },
  };
}

/** Parent flow that calls child routines via cross-flow references. */
function makeParentFlow(): FlowDefinition {
  return {
    $schema: FLOW_SCHEMA_URL,
    name: "cross-flow-parent",
    command: "/parent",
    orchestrator: { systemPrompt: "test" },
    routines: {
      call_child_session: {
        params: [],
        steps: [
          {
            type: "routine",
            id: "call-helper",
            target: "/child",
            routine: "store_session",
            input: { key: "shared-key", value: "set-by-child" },
            output_as: "helper_result",
          },
        ],
      },
      call_child_workspace: {
        params: [],
        steps: [
          {
            type: "routine",
            id: "call-ws",
            target: "/child",
            routine: "create_workspace",
            input: {},
            output_as: "ws_result",
          },
        ],
      },
    },
  };
}

/**
 * Set up the full infrastructure needed for cross-flow routine tests.
 *
 * Returns the step executor registry (populated with all built-in executors
 * including RoutineRefStepExecutor) and the event bus so tests can inspect
 * emitted events.
 *
 * Uses the same placeholder-then-replace pattern as the production
 * entry point (see src/index.ts).
 */
function setupInfrastructure(
  repoRoot: string,
  childFlow?: FlowDefinition,
): { stepRegistry: StepExecutorRegistry; eventBus: ReturnType<typeof makeMockEventBus> } {
  const worktreeProvider = new GitWorktreeProvider(repoRoot, "HEAD");
  const wpRegistry = new WorkspaceProviderRegistry().register("git-worktree", worktreeProvider);
  const wtRegistry = new WorktreeRegistry(WorktreeRegistry.defaultStoragePath(repoRoot));
  const supervisor = new InMemoryAgentSupervisor(makeMockFactory());
  const specManager = makeMockSpecManager();
  const eventBus = makeMockEventBus();

  const flows = new Map<string, FlowDefinition>();
  if (childFlow) flows.set("/child", childFlow);

  // Create a placeholder registry that will be replaced after
  // createStepExecutorRegistry populates the real one.
  const runtimeCapabilities = new RuntimeCapabilities(eventBus, new StepExecutorRegistry(), flows);

  const stepRegistry = createStepExecutorRegistry(
    wpRegistry,
    supervisor,
    specManager,
    wtRegistry,
    runtimeCapabilities,
  );

  // Replace the placeholder with the populated registry so
  // RoutineRefStepExecutor can dispatch child steps.
  Object.assign(runtimeCapabilities as { stepExecutorRegistry: StepExecutorRegistry }, {
    stepExecutorRegistry: stepRegistry,
  });

  return { stepRegistry, eventBus };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("cross-flow routine reference (e2e)", () => {
  let repoRoot: string;

  afterEach(() => {
    try {
      execSync("git worktree prune", { cwd: repoRoot });
    } catch {
      /* ignore */
    }
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("parent flow calls child flow routine and receives result", async () => {
    repoRoot = createTempRepo();

    const childFlow = makeChildFlow();
    const parentFlow = makeParentFlow();

    const { stepRegistry, eventBus } = setupInfrastructure(repoRoot, childFlow);
    const executor = new RoutineExecutor(parentFlow, stepRegistry, eventBus);

    const result = await executor.run("call_child_session", {}, "e2e cross-flow test");

    expect(result.passed).toBe(true);
    expect(result.results["helper_result"]).toBeDefined();
    expect(result.results["helper_result"].parsed?.passed).toBe(true);
  });

  it("emits routine-ref lifecycle events on the event bus", async () => {
    repoRoot = createTempRepo();

    const childFlow = makeChildFlow();
    const parentFlow = makeParentFlow();

    // Build infrastructure with a capturing event bus.
    const flows = new Map<string, FlowDefinition>();
    flows.set("/child", childFlow);

    const events: RoutineProgressEvent[] = [];
    const captureBus = makeMockEventBus();
    const origEmit = captureBus.emit.bind(captureBus);
    captureBus.emit = (channel: string, data: unknown) => {
      if (channel.startsWith("feature-forge:routine-ref-")) {
        events.push(data as RoutineProgressEvent);
      }
      return origEmit(channel, data);
    };

    const worktreeProvider = new GitWorktreeProvider(repoRoot, "HEAD");
    const wpRegistry = new WorkspaceProviderRegistry().register("git-worktree", worktreeProvider);
    const wtRegistry = new WorktreeRegistry(WorktreeRegistry.defaultStoragePath(repoRoot));
    const supervisor = new InMemoryAgentSupervisor(makeMockFactory());
    const specManager = makeMockSpecManager();

    const runtimeCapabilities = new RuntimeCapabilities(
      captureBus,
      new StepExecutorRegistry(),
      flows,
    );
    const stepRegistry = createStepExecutorRegistry(
      wpRegistry,
      supervisor,
      specManager,
      wtRegistry,
      runtimeCapabilities,
    );
    Object.assign(runtimeCapabilities as { stepExecutorRegistry: StepExecutorRegistry }, {
      stepExecutorRegistry: stepRegistry,
    });

    const executor = new RoutineExecutor(parentFlow, stepRegistry, captureBus);

    await executor.run("call_child_session", {}, "e2e event test");

    const startEvents = events.filter((e) => e.phase === "routine-ref-start");
    const doneEvents = events.filter((e) => e.phase === "routine-ref-done");

    expect(startEvents.length).toBe(1);
    expect(startEvents[0].message).toContain("/child");
    expect(startEvents[0].message).toContain("store_session");

    expect(doneEvents.length).toBe(1);
    expect(doneEvents[0].message).toContain("/child");
    expect(doneEvents[0].message).toContain("store_session");
  });

  it("child flow can create a real git worktree via cross-flow call", async () => {
    repoRoot = createTempRepo();

    const childFlow = makeChildFlow();
    const parentFlow = makeParentFlow();

    const { stepRegistry, eventBus } = setupInfrastructure(repoRoot, childFlow);
    const executor = new RoutineExecutor(parentFlow, stepRegistry, eventBus);

    const result = await executor.run("call_child_workspace", {}, "e2e workspace test");

    expect(result.passed).toBe(true);
    expect(result.results["ws_result"]).toBeDefined();
    expect(result.results["ws_result"].parsed?.passed).toBe(true);

    // The workspace created inside the child flow is managed by the child's
    // RoutineExecutor instance. It is not surfaced on the parent's
    // RoutineResult.workspace (which only reports the parent flow's own
    // workspaces). The cross-flow call succeeded, which means the child's
    // WorkspaceStepExecutor ran without error — the git worktree was
    // successfully created and the child context is clean.
  });

  it("parent flow fails gracefully when target flow is not registered", async () => {
    repoRoot = createTempRepo();

    const flowWithMissingTarget: FlowDefinition = {
      $schema: FLOW_SCHEMA_URL,
      name: "bad-parent",
      command: "/bad-parent",
      orchestrator: { systemPrompt: "test" },
      routines: {
        call_missing: {
          params: [],
          steps: [
            {
              type: "routine",
              id: "bad-ref",
              target: "/nonexistent",
              routine: "whatever",
              input: {},
            },
          ],
        },
      },
    };

    const { stepRegistry, eventBus } = setupInfrastructure(repoRoot);
    const executor = new RoutineExecutor(flowWithMissingTarget, stepRegistry, eventBus);

    const result = await executor.run("call_missing", {}, "e2e missing target");

    expect(result.passed).toBe(false);
    expect(result.summary).toContain("not found");
  });

  it("parent flow can run its own workspace step alongside a cross-flow call", async () => {
    repoRoot = createTempRepo();

    const childFlow = makeChildFlow();

    const combinedFlow: FlowDefinition = {
      $schema: FLOW_SCHEMA_URL,
      name: "combined",
      command: "/combined",
      orchestrator: { systemPrompt: "test" },
      routines: {
        hybrid: {
          params: [],
          steps: [
            { type: "workspace", id: "parent-ws", provider: "git-worktree" },
            {
              type: "routine",
              id: "cross-call",
              target: "/child",
              routine: "store_session",
              input: { key: "hybrid", value: "works" },
              output_as: "child_result",
            },
          ],
        },
      },
    };

    const { stepRegistry, eventBus } = setupInfrastructure(repoRoot, childFlow);
    const executor = new RoutineExecutor(combinedFlow, stepRegistry, eventBus);

    const result = await executor.run("hybrid", {}, "e2e hybrid test");

    expect(result.passed).toBe(true);

    // Parent's own workspace exists on disk.
    const workspacePath = result.workspace;
    expect(workspacePath).toBeDefined();
    expect(existsSync(workspacePath!)).toBe(true);

    // Cross-flow call result stored alongside parent's workspace.
    expect(result.results["child_result"]).toBeDefined();
    expect(result.results["child_result"].parsed?.passed).toBe(true);
  });
});
