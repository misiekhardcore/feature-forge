/**
 * E2E test for routine progress display pipeline.
 *
 * Exercises the full RoutineExecutor cycle for run_build_loop against a real
 * git repo with mock agents. Verifies that the event bus → DisplayContribution →
 * ProgressRenderer → TuiRoutineWidget pipeline produces correct output.
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
import type { DisplayContribution } from "../src/orchestrator/progress/DisplayContribution";
import { ProgressRenderer } from "../src/orchestrator/progress/ProgressRenderer";
import { RoutineExecutor } from "../src/orchestrator/RoutineExecutor";
import type { RoutineProgressEvent } from "../src/orchestrator/RoutineProgress";
import { makeMockEventBus, makeMockFactory, makeMockSpecManager } from "../src/test-utils";
import { GitWorktreeProvider } from "../src/workspace/GitWorktreeProvider";
import { WorkspaceProviderRegistry } from "../src/workspace/WorkspaceProviderRegistry";
import { WorktreeRegistry } from "../src/workspace/WorktreeRegistry";

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
      routines: {
        run_build_loop: {
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
      },
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
    );
    const executor = new RoutineExecutor(flow, stepRegistry, makeMockEventBus());

    const agentState = new Map<string, { status: string; summary?: string }>();
    let capturedIteration = 0;
    let capturedMaxIterations = 0;

    const onEvent = (data: unknown): void => {
      const event = data as RoutineProgressEvent;
      for (const exec of executor.stepRegistry.getAll().values()) {
        const contrib: DisplayContribution | undefined = exec.getDisplayContribution(event);
        if (!contrib) continue;
        if (contrib.agentId && contrib.agentStatus) {
          agentState.set(contrib.agentId, {
            status: contrib.agentStatus,
            summary: contrib.agentSummary,
          });
        }
        if (contrib.iteration !== undefined) capturedIteration = contrib.iteration;
        if (contrib.maxIterations !== undefined) capturedMaxIterations = contrib.maxIterations;
      }
    };

    executor.eventBus.on("feature-forge:agent-started", onEvent);
    executor.eventBus.on("feature-forge:agent-done", onEvent);
    executor.eventBus.on("feature-forge:loop-round-start", onEvent);

    const result = await executor.run("run_build_loop", { task: "t", plan: "p" }, "e2e");

    expect(result.passed).toBe(true);
    expect(result.workspace).toBeDefined();
    expect(existsSync(result.workspace!)).toBe(true);

    expect(agentState.has("builder")).toBe(true);
    expect(agentState.get("builder")!.status).toBe("done");
    expect(capturedIteration).toBe(0);
    expect(capturedMaxIterations).toBe(1);

    const mockTheme = { fg: (_c: string, t: string) => t };
    const rows = [...agentState].map(
      ([l, a]) => `${a.status === "done" ? "✓" : "⏳"} ${l}${a.summary ? ` — ${a.summary}` : ""}`,
    );
    const lines = ProgressRenderer.buildWidgetLines({
      theme: mockTheme,
      title: "run_build_loop",
      subtitle: `iteration ${capturedIteration + 1}/${capturedMaxIterations}`,
      rows,
      path: result.workspace,
    });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes("run_build_loop"))).toBe(true);
    expect(lines.some((l) => l.includes("builder"))).toBe(true);

    const status = ProgressRenderer.buildStatusLine({
      theme: mockTheme,
      title: "run_build_loop",
      subtitle: `${capturedIteration + 1}/${capturedMaxIterations}`,
      tags: [...agentState].map(([l, a]) => `${a.status === "done" ? "✓" : "⏳"} ${l}`),
    });
    expect(status).toContain("run_build_loop");
    expect(status).toContain("builder");
  });
});
