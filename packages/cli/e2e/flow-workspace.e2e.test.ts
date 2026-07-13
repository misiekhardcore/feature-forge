/**
 * End-to-end tests for workspace creation and destruction through flows.
 *
 * These tests exercise the full RoutineExecutor cycle — creating a worktree
 * via a flow's workspace step, verifying registration, then cleaning up via
 * a cleanup step — all against a real git repository.
 *
 * Run via: `npm run test:e2e`
 */

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createStepExecutorRegistry } from "../src/orchestrator/createStepExecutorRegistry";
import type { FlowDefinition } from "../src/orchestrator/FlowInstruction";
import { FLOW_SCHEMA_URL } from "../src/orchestrator/FlowInstruction";
import { RoutineExecutor } from "../src/orchestrator/RoutineExecutor";
import { makeMockTypedEventBus } from "../src/test-utils";
import { GitWorktreeProvider } from "../src/workspace/GitWorktreeProvider";
import { WorkspaceProviderRegistry } from "../src/workspace/WorkspaceProviderRegistry";
import { WorktreeRegistry } from "../src/workspace/WorktreeRegistry";

// ── Helpers ───────────────────────────────────────────────────────────────

function git(dir: string, args: string): string {
  return execSync(`git ${args}`, { cwd: dir, encoding: "utf-8" }).trim();
}

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-e2e-flow-ws-"));
  execSync("git init --initial-branch=main", { cwd: dir });
  execSync('git config user.email "test@forge.local"', { cwd: dir });
  execSync('git config user.name "Forge E2E"', { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# test repo\n");
  execSync("git add README.md", { cwd: dir });
  execSync('git commit -m "initial commit"', { cwd: dir });
  return dir;
}

/**
 * Minimal flow with a workspace-only routine + cleanup routine.
 * No agent steps — just workspace creation and destruction.
 */
function makeWorkspaceFlow(): FlowDefinition {
  return {
    $schema: FLOW_SCHEMA_URL,
    name: "ws-test",
    command: "/ws-test",
    orchestrator: { systemPrompt: "test" },
    routines: {
      create_workspace: {
        params: [],
        steps: [
          {
            id: "wt",
            type: "workspace",
            provider: "git-worktree",
          },
        ],
      },
      destroy_workspace: {
        params: [{ name: "path", description: "Worktree path to release" }],
        steps: [{ type: "cleanup", id: "cleanup", of: "{{path}}" }],
      },
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("Flow workspace lifecycle (e2e)", () => {
  let repoRoot: string;
  let flow: FlowDefinition;
  let executor: RoutineExecutor;
  let worktreeRegistry: WorktreeRegistry;

  beforeEach(() => {
    repoRoot = createTempRepo();
    flow = makeWorkspaceFlow();

    const worktreeProvider = new GitWorktreeProvider(repoRoot, "HEAD");
    const workspaceProviderRegistry = new WorkspaceProviderRegistry().register(
      "git-worktree",
      worktreeProvider,
    );

    worktreeRegistry = new WorktreeRegistry(WorktreeRegistry.defaultStoragePath(repoRoot));

    const stepRegistry = createStepExecutorRegistry(
      workspaceProviderRegistry,
      null as never, // supervisor — not used for workspace/cleanup steps
      null as never, // specManager — not used for workspace/cleanup steps
      worktreeRegistry,
    );

    executor = new RoutineExecutor(flow, stepRegistry, makeMockTypedEventBus());
  });

  afterEach(() => {
    try {
      execSync("git worktree prune", { cwd: repoRoot });
    } catch {
      // ignore
    }
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("creates a worktree via flow, registers it, and destroys it", async () => {
    const result = await executor.run("create_workspace", {}, "create ws for e2e");

    expect(result.passed).toBe(true);
    expect(result.workspace).toBeDefined();
    expect(result.workspace).toContain(".forge/worktrees/ws-");

    const workspacePath = result.workspace!;

    // Verify the directory exists and is a git worktree
    expect(existsSync(workspacePath)).toBe(true);
    expect(existsSync(join(workspacePath, ".git"))).toBe(true);

    // Verify listed by git
    const listOutput = git(repoRoot, "worktree list --porcelain");
    expect(listOutput).toContain(workspacePath);

    // Verify registered in persistent registry
    await worktreeRegistry.load();
    const registered = worktreeRegistry.get(workspacePath);
    expect(registered).toBeDefined();
    expect(registered!.path).toBe(workspacePath);

    // Cleanup via flow
    const cleanupResult = await executor.run(
      "destroy_workspace",
      { path: workspacePath },
      "destroy ws",
    );

    expect(cleanupResult.passed).toBe(true);

    // Verify directory removed
    expect(existsSync(workspacePath)).toBe(false);

    // Verify deregistered
    await worktreeRegistry.load();
    expect(worktreeRegistry.get(workspacePath)).toBeUndefined();

    // Verify not listed by git
    const afterList = git(repoRoot, "worktree list --porcelain");
    expect(afterList).not.toContain(workspacePath);
  });

  it("creates multiple workspaces with unique paths", async () => {
    const result1 = await executor.run("create_workspace", {}, "first");
    const result2 = await executor.run("create_workspace", {}, "second");

    expect(result1.passed).toBe(true);
    expect(result2.passed).toBe(true);
    expect(result1.workspace).toBeDefined();
    expect(result2.workspace).toBeDefined();
    expect(result1.workspace).not.toBe(result2.workspace);

    // Both exist on disk
    expect(existsSync(result1.workspace!)).toBe(true);
    expect(existsSync(result2.workspace!)).toBe(true);

    // Both registered
    await worktreeRegistry.load();
    expect(worktreeRegistry.get(result1.workspace!)).toBeDefined();
    expect(worktreeRegistry.get(result2.workspace!)).toBeDefined();

    // Clean up both (destroy_workspace destroys all when no `of` parameter,
    // but we pass explicit paths for targeted cleanup)
    await executor.run("destroy_workspace", { path: result1.workspace! }, "destroy");
    await executor.run("destroy_workspace", { path: result2.workspace! }, "destroy");

    expect(existsSync(result1.workspace!)).toBe(false);
    expect(existsSync(result2.workspace!)).toBe(false);
  });

  it("worktree registry file is created at <repo>/.forge/worktrees.json", async () => {
    await executor.run("create_workspace", {}, "create");

    const registryPath = WorktreeRegistry.defaultStoragePath(repoRoot);
    expect(existsSync(registryPath)).toBe(true);
  });

  it("cleanup step handles non-existent path gracefully", async () => {
    const result = await executor.run(
      "destroy_workspace",
      { path: "/nonexistent/path" },
      "destroy",
    );

    // Cleanup is best-effort — should not throw, just report success
    expect(result.passed).toBe(true);
  });
});
