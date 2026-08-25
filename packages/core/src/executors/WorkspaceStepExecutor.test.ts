import { randomUUID } from "node:crypto";

import { makeMockTypedEventBus } from "@feature-forge/core/test-utils";
import { describe, expect, it, vi } from "vitest";

import { FlowContext } from "../flows/FlowContext";
import type { WorkspaceInstruction } from "../flows/FlowInstruction";
import { WorkspaceManager } from "../workspace/WorkspaceManager";
import type { CreateWorkspaceOptions } from "../workspace/WorkspaceProvider";
import { WorkspaceProvider } from "../workspace/WorkspaceProvider";
import { WorkspaceProviderRegistry } from "../workspace/WorkspaceProviderRegistry";
import { WorktreeRegistry } from "../workspace/WorktreeRegistry";
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

  override async createWorkspace(
    workspaceId: string,
    _options?: CreateWorkspaceOptions,
  ): Promise<string> {
    const path = `/test/${workspaceId}`;
    this.created.push(path);
    return path;
  }

  override async destroyWorkspace(path: string, _branch?: string): Promise<void> {
    this.destroyed.push(path);
  }
}

function stubWorktreeRegistry(): WorktreeRegistry {
  const registry = new WorktreeRegistry();
  return registry;
}

function stubWorkspaceManager(
  provider: WorkspaceProvider,
  registry: WorktreeRegistry,
): WorkspaceManager {
  return new WorkspaceManager(provider, registry);
}

// ── Tests ────────────────────────────────────────────────────

describe("WorkspaceStepExecutor", () => {
  it("creates a workspace and stores the handle in context under the instruction id", async () => {
    const provider = new CountingProvider();
    const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
    const wtRegistry = stubWorktreeRegistry();
    const wm = stubWorkspaceManager(provider, wtRegistry);
    const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry, wm);

    const instruction: WorkspaceInstruction = {
      type: "workspace",
      id: "ws1",
      provider: "git-worktree",
    };
    const context = new FlowContext({ results: new Map(), prompt: "task" });
    const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

    const expectedId = `ws-00000000`;
    expect(provider.created).toContain(`/test/${expectedId}`);
    expect(result.workspaces.has("ws1")).toBe(true);
    expect(result.workspaces.get("ws1")!.path).toBe(`/test/${expectedId}`);
    expect(result.results.get("ws1")!.parsed!.passed).toBe(true);
  });

  it("stores each workspace under its own instruction id", async () => {
    vi.mocked(randomUUID)
      .mockImplementationOnce(() => "11111111-1111-4111-a111-111111111111")
      .mockImplementationOnce(() => "22222222-2222-4222-a222-222222222222");

    const provider = new CountingProvider();
    const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
    const wtRegistry = stubWorktreeRegistry();
    const wm = stubWorkspaceManager(provider, wtRegistry);
    const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry, wm);

    const context = new FlowContext({ results: new Map(), prompt: "task" });
    const first = await executor.execute(
      { type: "workspace", id: "docs-ws", provider: "git-worktree" },
      context,
      vi.fn(),
      makeMockTypedEventBus(),
    );
    const second = await executor.execute(
      { type: "workspace", id: "test-ws", provider: "git-worktree" },
      first,
      vi.fn(),
      makeMockTypedEventBus(),
    );

    expect(second.workspaces.has("docs-ws")).toBe(true);
    expect(second.workspaces.has("test-ws")).toBe(true);
    expect(second.workspaces.get("docs-ws")!.path).toBe("/test/ws-11111111");
    expect(second.workspaces.get("test-ws")!.path).toBe("/test/ws-22222222");
    expect(second.workspaces.get("docs-ws")!.path).not.toBe(second.workspaces.get("test-ws")!.path);
    expect(second.results.get("docs-ws")!.parsed!.passed).toBe(true);
    expect(second.results.get("test-ws")!.parsed!.passed).toBe(true);
  });

  it("throws for an unregistered provider", async () => {
    const provRegistry = new WorkspaceProviderRegistry();
    const wtRegistry = stubWorktreeRegistry();
    const wm = stubWorkspaceManager(undefined as unknown as WorkspaceProvider, wtRegistry);
    const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry, wm);

    const instruction: WorkspaceInstruction = {
      type: "workspace",
      id: "ws1",
      provider: "current-dir",
    };
    const context = new FlowContext({ results: new Map(), prompt: "task" });

    await expect(
      executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus()),
    ).rejects.toThrow('Unknown workspace provider "current-dir"');
  });

  it("does not mutate the original context", async () => {
    const provider = new CountingProvider();
    const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
    const wtRegistry = stubWorktreeRegistry();
    const wm = stubWorkspaceManager(provider, wtRegistry);
    const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry, wm);

    const instruction: WorkspaceInstruction = {
      type: "workspace",
      id: "ws",
      provider: "git-worktree",
    };
    const context = new FlowContext({ results: new Map(), prompt: "task" });
    await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

    expect(context.workspaces.size).toBe(0);
    expect(context.results.size).toBe(0);
  });

  it("throws AbortError when signal is aborted at entry", async () => {
    const provider = new CountingProvider();
    const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
    const wtRegistry = stubWorktreeRegistry();
    const wm = stubWorkspaceManager(provider, wtRegistry);
    const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry, wm);

    const instruction: WorkspaceInstruction = {
      type: "workspace",
      id: "ws1",
      provider: "git-worktree",
    };
    const context = new FlowContext({ results: new Map(), prompt: "task" });
    const controller = new AbortController();
    controller.abort();

    await expect(
      executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus(), controller.signal),
    ).rejects.toThrow();
  });

  it("passes instruction.symlinks to provider.createWorkspace", async () => {
    const provider = new CountingProvider();
    // Spy on createWorkspace to verify the options passed
    const createSpy = vi.spyOn(provider, "createWorkspace");

    const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
    const wtRegistry = stubWorktreeRegistry();
    const wm = stubWorkspaceManager(provider, wtRegistry);
    const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry, wm);

    const instruction: WorkspaceInstruction = {
      type: "workspace",
      id: "ws1",
      provider: "git-worktree",
      symlinks: ["custom-dir", "another-dir"],
    };
    const context = new FlowContext({ results: new Map(), prompt: "task" });
    await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

    expect(createSpy).toHaveBeenCalledWith(expect.stringContaining("ws-"), {
      symlinks: ["custom-dir", "another-dir"],
      branch: expect.stringContaining("forge/ws-") as string,
    });
  });

  it("forwards baseRef to provider.createWorkspace", async () => {
    const provider = new CountingProvider();
    const createSpy = vi.spyOn(provider, "createWorkspace");

    const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
    const wtRegistry = stubWorktreeRegistry();
    const wm = stubWorkspaceManager(provider, wtRegistry);
    const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry, wm);

    const instruction: WorkspaceInstruction = {
      type: "workspace",
      id: "ws1",
      provider: "git-worktree",
      baseRef: "origin/HEAD",
    };
    const context = new FlowContext({ results: new Map(), prompt: "task" });
    await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

    expect(createSpy).toHaveBeenCalledWith(
      expect.stringContaining("ws-"),
      expect.objectContaining({
        baseRef: "origin/HEAD",
      }),
    );
  });

  describe("eventBus", () => {
    it("emits a workspace-ready event after workspace creation", async () => {
      const provider = new CountingProvider();
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const wtRegistry = stubWorktreeRegistry();
      const wm = stubWorkspaceManager(provider, wtRegistry);
      const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry, wm);

      const instruction: WorkspaceInstruction = {
        type: "workspace",
        id: "ws1",
        provider: "git-worktree",
      };
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      const eventBus = makeMockTypedEventBus();
      await executor.execute(instruction, context, vi.fn(), eventBus);

      expect(eventBus.raw.emit).toHaveBeenCalledTimes(1);
      expect(eventBus.raw.emit).toHaveBeenCalledWith(
        "feature-forge:workspace-ready",
        expect.objectContaining({
          phase: "workspace-ready",
          message: expect.stringContaining("ws-") as string,
          details: expect.objectContaining({
            path: expect.stringContaining("/test/ws-") as string,
          }),
        }),
      );
    });

    it("works with a mocked eventBus", async () => {
      const provider = new CountingProvider();
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const wtRegistry = stubWorktreeRegistry();
      const wm = stubWorkspaceManager(provider, wtRegistry);
      const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry, wm);

      const instruction: WorkspaceInstruction = {
        type: "workspace",
        id: "ws1",
        provider: "git-worktree",
      };
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(result.workspaces.has("ws1")).toBe(true);
    });
  });

  describe("execute — branch", () => {
    it("passes branch to WorkspaceHandle", async () => {
      const provider = new CountingProvider();
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const wtRegistry = stubWorktreeRegistry();
      const wm = stubWorkspaceManager(provider, wtRegistry);
      const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry, wm);

      const instruction: WorkspaceInstruction = {
        type: "workspace",
        id: "ws1",
        provider: "git-worktree",
      };
      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      const handle = result.workspaces.get("ws1");
      expect(handle).toBeDefined();
      expect(handle!.branch).toBe(`forge/ws-00000000`);
    });
    it("uses explicit branch from instruction when provided", async () => {
      const provider = new CountingProvider();
      const createSpy = vi.spyOn(provider, "createWorkspace");
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const wtRegistry = stubWorktreeRegistry();
      const wm = stubWorkspaceManager(provider, wtRegistry);
      const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry, wm);

      const instruction: WorkspaceInstruction = {
        type: "workspace",
        id: "ws1",
        provider: "git-worktree",
        branch: "feature/existing-pr",
      };
      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      const handle = result.workspaces.get("ws1");
      expect(handle).toBeDefined();
      expect(handle!.branch).toBe("feature/existing-pr");
      expect(createSpy).toHaveBeenCalledWith(expect.stringContaining("ws-"), {
        branch: "feature/existing-pr",
      });
    });

    it("resolves branch from template when instruction.branch contains a placeholder", async () => {
      const provider = new CountingProvider();
      const createSpy = vi.spyOn(provider, "createWorkspace");
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const wtRegistry = stubWorktreeRegistry();
      const wm = stubWorkspaceManager(provider, wtRegistry);
      const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry, wm);

      const instruction: WorkspaceInstruction = {
        type: "workspace",
        id: "ws1",
        provider: "git-worktree",
        branch: "{{branch}}",
      };
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
        params: new Map([["branch", "feature/from-template"]]),
      });
      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      const handle = result.workspaces.get("ws1");
      expect(handle!.branch).toBe("feature/from-template");
      expect(createSpy).toHaveBeenCalledWith(expect.stringContaining("ws-"), {
        branch: "feature/from-template",
      });
    });

    it("falls back to default branch when resolved branch is empty", async () => {
      const provider = new CountingProvider();
      const createSpy = vi.spyOn(provider, "createWorkspace");
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const wtRegistry = stubWorktreeRegistry();
      const wm = stubWorkspaceManager(provider, wtRegistry);
      const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry, wm);

      const instruction: WorkspaceInstruction = {
        type: "workspace",
        id: "ws1",
        provider: "git-worktree",
        branch: "{{branch}}",
      };
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
      });
      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      const handle = result.workspaces.get("ws1");
      expect(handle!.branch).toBe("forge/ws-00000000");
      expect(createSpy).toHaveBeenCalledWith(expect.stringContaining("ws-"), {
        branch: "forge/ws-00000000",
      });
    });
  });
});
