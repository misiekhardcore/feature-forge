import { describe, expect, it, vi } from "vitest";

import { WorkspaceProvider } from "../../workspace/WorkspaceProvider";
import { WorkspaceProviderRegistry } from "../../workspace/WorkspaceProviderRegistry";
import { WorktreeRegistry } from "../../workspace/WorktreeRegistry";
import { FlowContext } from "../FlowContext";
import type { WorkspaceInstruction } from "../FlowInstruction";
import type { RoutineProgressEvent } from "../RoutineProgress";
import { WorkspaceStepExecutor } from "./WorkspaceStepExecutor";

// ── Helpers ──────────────────────────────────────────────────

const MOCK_TIMESTAMP = "1712345678000";

class CountingProvider extends WorkspaceProvider {
  created: string[] = [];
  destroyed: string[] = [];

  override async createWorkspace(workspaceId: string): Promise<string> {
    const path = `/test/${workspaceId}`;
    this.created.push(path);
    return path;
  }

  override async destroyWorkspace(path: string): Promise<void> {
    this.destroyed.push(path);
  }
}

function stubWorktreeRegistry(): WorktreeRegistry {
  const registry = new WorktreeRegistry();
  return registry;
}

function mockDateNow() {
  vi.spyOn(Date, "now").mockReturnValue(Number(MOCK_TIMESTAMP));
}

// ── Tests ────────────────────────────────────────────────────

describe("WorkspaceStepExecutor", () => {
  it("creates a workspace and stores the handle in context under key 'ws'", async () => {
    mockDateNow();
    const provider = new CountingProvider();
    const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
    const wtRegistry = stubWorktreeRegistry();
    const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry);

    const instruction: WorkspaceInstruction = {
      type: "workspace",
      id: "ws1",
      provider: "git-worktree",
    };
    const context = new FlowContext(new Map(), "task");
    const result = await executor.execute(instruction, context, vi.fn());

    const expectedId = `ws-${MOCK_TIMESTAMP}`;
    expect(provider.created).toContain(`/test/${expectedId}`);
    expect(result.workspaces.has("ws")).toBe(true);
    expect(result.workspaces.get("ws")!.path).toBe(`/test/${expectedId}`);
    expect(result.results.get("ws")!.parsed!.passed).toBe(true);
  });

  it("throws for an unregistered provider", async () => {
    mockDateNow();
    const provRegistry = new WorkspaceProviderRegistry();
    const wtRegistry = stubWorktreeRegistry();
    const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry);

    // Use a valid union value but don't register it.
    const instruction: WorkspaceInstruction = {
      type: "workspace",
      id: "ws1",
      provider: "current-dir",
    };
    const context = new FlowContext(new Map(), "task");

    await expect(executor.execute(instruction, context, vi.fn())).rejects.toThrow(
      'Unknown workspace provider "current-dir"',
    );
  });

  it("does not mutate the original context", async () => {
    mockDateNow();
    const provider = new CountingProvider();
    const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
    const wtRegistry = stubWorktreeRegistry();
    const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry);

    const instruction: WorkspaceInstruction = {
      type: "workspace",
      id: "ws",
      provider: "git-worktree",
    };
    const context = new FlowContext(new Map(), "task");
    await executor.execute(instruction, context, vi.fn());

    expect(context.workspaces.size).toBe(0);
    expect(context.results.size).toBe(0);
  });

  describe("onProgress", () => {
    it("fires a workspace-ready event after workspace creation", async () => {
      mockDateNow();
      const provider = new CountingProvider();
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const wtRegistry = stubWorktreeRegistry();
      const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry);

      const instruction: WorkspaceInstruction = {
        type: "workspace",
        id: "ws1",
        provider: "git-worktree",
      };
      const context = new FlowContext(new Map(), "task");

      const events: RoutineProgressEvent[] = [];
      const onProgress = (e: RoutineProgressEvent) => events.push(e);

      await executor.execute(instruction, context, vi.fn(), onProgress);

      expect(events).toHaveLength(1);
      expect(events[0].phase).toBe("workspace-ready");
      expect(events[0].message).toContain("ws-");
      expect(events[0].details.workspace).toContain("/test/ws-");
    });

    it("does not fire events when onProgress is not provided", async () => {
      mockDateNow();
      const provider = new CountingProvider();
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const wtRegistry = stubWorktreeRegistry();
      const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry);

      const instruction: WorkspaceInstruction = {
        type: "workspace",
        id: "ws1",
        provider: "git-worktree",
      };
      const context = new FlowContext(new Map(), "task");

      // Should not throw when called without onProgress.
      const result = await executor.execute(instruction, context, vi.fn());

      expect(result.workspaces.has("ws")).toBe(true);
    });
  });
});
