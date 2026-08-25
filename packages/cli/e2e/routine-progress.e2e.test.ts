/**
 * E2E test for routine progress display pipeline.
 *
 * Exercises the full RoutineExecutor cycle for run_build_loop against a real
 * git repo with mock agents. Verifies that the event bus → DisplayProjection →
 * ProgressRenderer → TuiRoutineWidget pipeline produces correct output.
 *
 * Run via: `npm run test:e2e`
 */

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Theme } from "@earendil-works/pi-coding-agent";
import { InMemoryAgentSupervisor } from "@feature-forge/core/agents";
import { createStepExecutorRegistry } from "@feature-forge/core/executors";
import { FLOW_SCHEMA_URL, type FlowDefinition } from "@feature-forge/core/flows";
import type { RoutineProgressEvent } from "@feature-forge/core/routines";
import { RoutineExecutor } from "@feature-forge/core/routines";
import {
  GitWorktreeProvider,
  WorkspaceProviderRegistry,
  WorktreeRegistry,
} from "@feature-forge/core/workspace";
import { WorkspaceManager } from "@feature-forge/core/workspace";
import { afterEach, describe, expect, it } from "vitest";

import {
  makeMockFactory,
  makeMockSpecManager,
  makeMockToolRegistry,
  makeMockTypedEventBus,
} from "../src/test-utils";
import { MockWorkspaceProvider, MockWorktreeRegistry } from "../src/test-utils";
import { createAccumulatedState } from "../src/tui/progress/AccumulatedState";
import { applyEvent } from "../src/tui/progress/DisplayProjection";
import { ProgressRenderer } from "../src/tui/progress/ProgressRenderer";

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-e2e-progress-"));
  execSync("git init --initial-branch=main", { cwd: dir });
  execSync('git config user.email "test@forge.local"', { cwd: dir });
  execSync('git config user.name "Forge E2E"', { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# test\n");
  execSync("git add README.md", { cwd: dir });
  execSync('git commit -m "init"', { cwd: dir });
  return dir;
}

describe("routine progress display (e2e)", () => {
  let repoRoot: string;

  afterEach(() => {
    try {
      execSync("git worktree prune", { cwd: repoRoot });
    } catch {
      /* ignore */
    }
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("emits progress events and produces correct widget output", async () => {
    repoRoot = createTempRepo();

    const flow: FlowDefinition = {
      $schema: FLOW_SCHEMA_URL,
      name: "e2e-progress",
      command: "/e2e-progress",
      orchestrator: { systemPrompt: "test" },
      routines: [
        {
          id: "run_build_loop",
          params: [{ name: "task" }, { name: "plan" }],
          steps: [
            { type: "workspace", id: "ws", provider: "git-worktree" },
            {
              type: "loop",
              id: "loop",
              maxIterations: 1,
              steps: [
                {
                  type: "agent",
                  id: "builder",
                  systemPrompt: "build",
                  parseJson: false,
                  workingDir: { workspace: "ws" },
                  prompt: "Build: {{prompt}}",
                },
              ],
            },
          ],
        },
      ],
    };

    const worktreeProvider = new GitWorktreeProvider(repoRoot, "HEAD");
    const wpRegistry = new WorkspaceProviderRegistry().register("git-worktree", worktreeProvider);
    const wtRegistry = new WorktreeRegistry(WorktreeRegistry.defaultStoragePath(repoRoot));
    const supervisor = new InMemoryAgentSupervisor(makeMockFactory());
    const stepRegistry = createStepExecutorRegistry(
      wpRegistry,
      supervisor,
      makeMockSpecManager(),
      wtRegistry,
      new WorkspaceManager(new MockWorkspaceProvider(), new MockWorktreeRegistry()),
    );
    const executor = new RoutineExecutor(
      flow,
      stepRegistry,
      makeMockTypedEventBus(),
      makeMockToolRegistry(),
    );

    const acc = createAccumulatedState();

    const onEvent = (data: unknown): void => {
      applyEvent(acc, data as RoutineProgressEvent);
    };

    executor.eventBus.on("feature-forge:agent-started", onEvent);
    executor.eventBus.on("feature-forge:agent-done", onEvent);
    executor.eventBus.on("feature-forge:loop-round-start", onEvent);

    const result = await executor.run("run_build_loop", { task: "t", plan: "p" }, "e2e");

    expect(result.passed).toBe(true);
    expect(result.workspace).toBeDefined();
    expect(existsSync(result.workspace ?? "")).toBe(true);

    expect(acc.agentMap.has("mock")).toBe(true);
    expect(acc.agentMap.get("mock")!.status).toBe("done");
    expect(acc.iteration).toBe(0);
    expect(acc.maxIterations).toBe(1);

    const mockTheme = { fg: (_c: string, t: string) => t } as Theme;
    const rows = [...acc.agentMap].map(
      ([l, a]) => `${a.status === "done" ? "✓" : "→"} ${l}${a.summary ? ` — ${a.summary}` : ""}`,
    );
    const lines = ProgressRenderer.buildWidgetLines({
      theme: mockTheme,
      title: "run_build_loop",
      subtitle: `iteration ${acc.iteration + 1}/${acc.maxIterations}`,
      rows,
      path: result.workspace,
    });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes("run_build_loop"))).toBe(true);
    expect(lines.some((l) => l.includes("mock"))).toBe(true);

    const status = ProgressRenderer.buildStatusLine({
      theme: mockTheme,
      title: "run_build_loop",
      subtitle: `${acc.iteration + 1}/${acc.maxIterations}`,
      tags: [...acc.agentMap].map(([l, a]) => `${a.status === "done" ? "✓" : "→"} ${l}`),
    });
    expect(status).toContain("run_build_loop");
    expect(status).toContain("mock");
  });
});
