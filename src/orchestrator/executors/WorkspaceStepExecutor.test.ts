import { describe, expect, it, vi } from "vitest";

import { WorkspaceProvider } from "../../workspace/WorkspaceProvider";
import { WorkspaceProviderRegistry } from "../../workspace/WorkspaceProviderRegistry";
import { FlowContext } from "../FlowContext";
import type { WorkspaceInstruction } from "../FlowInstruction";
import { WorkspaceStepExecutor } from "./WorkspaceStepExecutor";

// ── Helpers ──────────────────────────────────────────────────

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

// ── Tests ────────────────────────────────────────────────────

describe("WorkspaceStepExecutor", () => {
  it("creates a workspace and stores the handle in context", async () => {
    const provider = new CountingProvider();
    const registry = new WorkspaceProviderRegistry().register("git-worktree", provider);
    const executor = new WorkspaceStepExecutor(registry);

    const instruction: WorkspaceInstruction = {
      type: "workspace",
      id: "ws1",
      provider: "git-worktree",
    };
    const context = new FlowContext(new Map(), "task");
    const result = await executor.execute(instruction, context, vi.fn());

    expect(provider.created).toContain("/test/ws1");
    expect(result.workspaces.has("ws1")).toBe(true);
    expect(result.workspaces.get("ws1")!.path).toBe("/test/ws1");
    expect(result.results.get("ws1")!.parsed!.passed).toBe(true);
  });

  it("throws for an unregistered provider", async () => {
    const registry = new WorkspaceProviderRegistry();
    const executor = new WorkspaceStepExecutor(registry);

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
    const provider = new CountingProvider();
    const registry = new WorkspaceProviderRegistry().register("git-worktree", provider);
    const executor = new WorkspaceStepExecutor(registry);

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
});
