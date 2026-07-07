import { describe, expect, it, vi } from "vitest";

import { makeMockEventBus } from "../../test-utils";
import { WorkspaceProvider } from "../../workspace/WorkspaceProvider";
import { WorkspaceProviderRegistry } from "../../workspace/WorkspaceProviderRegistry";
import { WorktreeRegistry } from "../../workspace/WorktreeRegistry";
import { FlowContext } from "../FlowContext";
import type { WorkspaceInstruction } from "../FlowInstruction";
import { WorkspaceStepExecutor } from "./WorkspaceStepExecutor";

// ── Mock setup ───────────────────────────────────────────────

const { MOCK_UUID } = vi.hoisted(() => ({
  MOCK_UUID: "00000000-0000-4000-a000-000000000000",
}));

vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  return {
    ...actual,
    randomUUID: vi.fn().mockReturnValue(MOCK_UUID),
  };
});

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

// ── Tests ────────────────────────────────────────────────────

describe("WorkspaceStepExecutor", () => {
  it("creates a workspace and stores the handle in context under key 'ws'", async () => {
    const provider = new CountingProvider();
    const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
    const wtRegistry = stubWorktreeRegistry();
    const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry);

    const instruction: WorkspaceInstruction = {
      type: "workspace",
      id: "ws1",
      provider: "git-worktree",
    };
    const context = new FlowContext({ results: new Map(), prompt: "task" });
    const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

    const expectedId = `ws-00000000`;
    expect(provider.created).toContain(`/test/${expectedId}`);
    expect(result.workspaces.has("ws")).toBe(true);
    expect(result.workspaces.get("ws")!.path).toBe(`/test/${expectedId}`);
    expect(result.results.get("ws")!.parsed!.passed).toBe(true);
  });

  it("throws for an unregistered provider", async () => {
    const provRegistry = new WorkspaceProviderRegistry();
    const wtRegistry = stubWorktreeRegistry();
    const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry);

    const instruction: WorkspaceInstruction = {
      type: "workspace",
      id: "ws1",
      provider: "current-dir",
    };
    const context = new FlowContext({ results: new Map(), prompt: "task" });

    await expect(
      executor.execute(instruction, context, vi.fn(), makeMockEventBus()),
    ).rejects.toThrow('Unknown workspace provider "current-dir"');
  });

  it("does not mutate the original context", async () => {
    const provider = new CountingProvider();
    const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
    const wtRegistry = stubWorktreeRegistry();
    const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry);

    const instruction: WorkspaceInstruction = {
      type: "workspace",
      id: "ws",
      provider: "git-worktree",
    };
    const context = new FlowContext({ results: new Map(), prompt: "task" });
    await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

    expect(context.workspaces.size).toBe(0);
    expect(context.results.size).toBe(0);
  });

  it("throws AbortError when signal is aborted at entry", async () => {
    const provider = new CountingProvider();
    const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
    const wtRegistry = stubWorktreeRegistry();
    const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry);

    const instruction: WorkspaceInstruction = {
      type: "workspace",
      id: "ws1",
      provider: "git-worktree",
    };
    const context = new FlowContext({ results: new Map(), prompt: "task" });
    const controller = new AbortController();
    controller.abort();

    await expect(
      executor.execute(instruction, context, vi.fn(), makeMockEventBus(), controller.signal),
    ).rejects.toThrow();
  });

  describe("eventBus", () => {
    it("emits a workspace-ready event after workspace creation", async () => {
      const provider = new CountingProvider();
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const wtRegistry = stubWorktreeRegistry();
      const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry);

      const instruction: WorkspaceInstruction = {
        type: "workspace",
        id: "ws1",
        provider: "git-worktree",
      };
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      const eventBus = makeMockEventBus();
      await executor.execute(instruction, context, vi.fn(), eventBus);

      expect(eventBus.emit).toHaveBeenCalledTimes(1);
      expect(eventBus.emit).toHaveBeenCalledWith(
        "feature-forge:workspace-ready",
        expect.objectContaining({
          phase: "workspace-ready",
          message: expect.stringContaining("ws-") as string,
          details: expect.objectContaining({
            workspace: expect.stringContaining("/test/ws-") as string,
          }),
        }),
      );
    });

    it("works with a mocked eventBus", async () => {
      const provider = new CountingProvider();
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const wtRegistry = stubWorktreeRegistry();
      const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry);

      const instruction: WorkspaceInstruction = {
        type: "workspace",
        id: "ws1",
        provider: "git-worktree",
      };
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      expect(result.workspaces.has("ws")).toBe(true);
    });
  });
});
