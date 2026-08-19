// Test-only value imports from cli: self-heal when cli test-utils
// moves to core (S6) (#229).
import { makeMockTypedEventBus } from "@feature-forge/cli/src/test-utils";
import { FlowContext } from "@feature-forge/core/src/flows/FlowContext";
import type { CleanupInstruction } from "@feature-forge/core/src/flows/FlowInstruction";
import { WorkspaceHandle } from "@feature-forge/core/src/workspace/WorkspaceHandle";
import { WorkspaceManager } from "@feature-forge/core/src/workspace/WorkspaceManager";
import type { CreateWorkspaceOptions } from "@feature-forge/core/src/workspace/WorkspaceProvider";
import { WorkspaceProvider } from "@feature-forge/core/src/workspace/WorkspaceProvider";
import { WorkspaceProviderRegistry } from "@feature-forge/core/src/workspace/WorkspaceProviderRegistry";
import { WorktreeRegistry } from "@feature-forge/core/src/workspace/WorktreeRegistry";
import { describe, expect, it, vi } from "vitest";

import { CleanupStepExecutor } from "./CleanupStepExecutor";

// ── Helpers ──────────────────────────────────────────────────

class TrackingProvider extends WorkspaceProvider {
  destroyedPaths: string[] = [];
  destroyedBranches: (string | undefined)[] = [];

  override async createWorkspace(id: string, _options?: CreateWorkspaceOptions): Promise<string> {
    return `/fake/${id}`;
  }

  override async destroyWorkspace(path: string, branch?: string): Promise<void> {
    this.destroyedPaths.push(path);
    this.destroyedBranches.push(branch);
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

describe("CleanupStepExecutor", () => {
  describe("execute", () => {
    it("throws AbortError when signal is aborted at entry", async () => {
      const provider = new TrackingProvider();
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const wtRegistry = stubWorktreeRegistry();
      const wm = stubWorkspaceManager(provider, wtRegistry);
      const executor = new CleanupStepExecutor(provRegistry, wtRegistry, wm);

      const workspaceHandle = new WorkspaceHandle("/fake/ws1", new Date());
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
        workspaces: new Map([["ws1", workspaceHandle]]),
      });

      const instruction: CleanupInstruction = { type: "cleanup", id: "c1", of: "ws1" };
      const controller = new AbortController();
      controller.abort();

      await expect(
        executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus(), controller.signal),
      ).rejects.toThrow();

      // No workspace was destroyed.
      expect(provider.destroyedPaths).toHaveLength(0);
    });

    it("destroys the workspace referenced by `of`", async () => {
      const provider = new TrackingProvider();
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const wtRegistry = stubWorktreeRegistry();
      const wm = stubWorkspaceManager(provider, wtRegistry);
      const executor = new CleanupStepExecutor(provRegistry, wtRegistry, wm);

      const workspaceHandle = new WorkspaceHandle("/fake/ws1", new Date());
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
        workspaces: new Map([["ws1", workspaceHandle]]),
      });

      const instruction: CleanupInstruction = { type: "cleanup", id: "c1", of: "ws1" };
      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(provider.destroyedPaths).toContain("/fake/ws1");
      expect(result.results.get("c1")!.parsed!.passed).toBe(true);
    });

    it("passes branch to destroyWorkspace when handle has branch", async () => {
      const provider = new TrackingProvider();
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const wtRegistry = stubWorktreeRegistry();
      const wm = stubWorkspaceManager(provider, wtRegistry);
      const executor = new CleanupStepExecutor(provRegistry, wtRegistry, wm);

      const handle = new WorkspaceHandle("/fake/ws1", new Date(), "forge/ws-abc");
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
        workspaces: new Map([["ws1", handle]]),
      });

      const instruction: CleanupInstruction = { type: "cleanup", id: "c1", of: "ws1" };
      await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(provider.destroyedPaths).toContain("/fake/ws1");
      expect(provider.destroyedBranches).toContain("forge/ws-abc");
    });

    it("resolves placeholders in `of`", async () => {
      const provider = new TrackingProvider();
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const wtRegistry = stubWorktreeRegistry();
      const wm = stubWorkspaceManager(provider, wtRegistry);
      const executor = new CleanupStepExecutor(provRegistry, wtRegistry, wm);

      const workspaceHandle = new WorkspaceHandle("/fake/ws1", new Date());
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
        workspaces: new Map([["ws1", workspaceHandle]]),
        params: new Map([["target", "ws1"]]),
      });

      const instruction: CleanupInstruction = { type: "cleanup", id: "c1", of: "{{target}}" };
      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(provider.destroyedPaths).toContain("/fake/ws1");
      expect(result.results.get("c1")!.parsed!.passed).toBe(true);
    });

    it("destroys all workspaces when `of` is omitted", async () => {
      const provider = new TrackingProvider();
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const wtRegistry = stubWorktreeRegistry();
      const wm = stubWorkspaceManager(provider, wtRegistry);
      const executor = new CleanupStepExecutor(provRegistry, wtRegistry, wm);

      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
        workspaces: new Map([
          ["ws1", new WorkspaceHandle("/fake/ws1", new Date())],
          ["ws2", new WorkspaceHandle("/fake/ws2", new Date())],
        ]),
      });

      const instruction: CleanupInstruction = { type: "cleanup", id: "c1" };
      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(provider.destroyedPaths).toContain("/fake/ws1");
      expect(provider.destroyedPaths).toContain("/fake/ws2");
      expect(result.results.get("c1")!.parsed!.passed).toBe(true);
    });

    it("passes branch when destroying all workspaces", async () => {
      const provider = new TrackingProvider();
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const wtRegistry = stubWorktreeRegistry();
      const wm = stubWorkspaceManager(provider, wtRegistry);
      const executor = new CleanupStepExecutor(provRegistry, wtRegistry, wm);

      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
        workspaces: new Map([
          ["ws1", new WorkspaceHandle("/fake/ws1", new Date(), "forge/ws-one")],
          ["ws2", new WorkspaceHandle("/fake/ws2", new Date(), "forge/ws-two")],
        ]),
      });

      const instruction: CleanupInstruction = { type: "cleanup", id: "c1" };
      await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(provider.destroyedBranches).toContain("forge/ws-one");
      expect(provider.destroyedBranches).toContain("forge/ws-two");
    });

    it("continues even if one workspace destruction fails", async () => {
      const goodProvider = new TrackingProvider();
      const failingProvider = new (class extends WorkspaceProvider {
        override async createWorkspace(
          _id: string,
          _options?: CreateWorkspaceOptions,
        ): Promise<string> {
          return "/fail";
        }
        override async destroyWorkspace(_path: string, _branch?: string): Promise<void> {
          throw new Error("destroy failed");
        }
      })();

      const provRegistry = new WorkspaceProviderRegistry()
        .register("git-worktree", goodProvider)
        .register("failing", failingProvider);

      const wtRegistry = stubWorktreeRegistry();
      const wm = stubWorkspaceManager(goodProvider, wtRegistry);
      const executor = new CleanupStepExecutor(provRegistry, wtRegistry, wm);

      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
        workspaces: new Map([["ws1", new WorkspaceHandle("/fake/ws1", new Date())]]),
      });

      const instruction: CleanupInstruction = { type: "cleanup", id: "c1" };
      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(goodProvider.destroyedPaths).toContain("/fake/ws1");
      expect(result.results.get("c1")!.parsed!.passed).toBe(true);
    });

    it("handles empty workspaces gracefully", async () => {
      const provider = new TrackingProvider();
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const wtRegistry = stubWorktreeRegistry();
      const wm = stubWorkspaceManager(provider, wtRegistry);
      const executor = new CleanupStepExecutor(provRegistry, wtRegistry, wm);

      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
      });
      const instruction: CleanupInstruction = { type: "cleanup", id: "c1" };
      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(result.results.get("c1")!.parsed!.passed).toBe(true);
      expect(result.results.get("c1")!.raw).toContain('"cleaned":[]');
    });

    describe("eventBus", () => {
      it("emits cleanup-start and cleanup-done events", async () => {
        const provider = new TrackingProvider();
        const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
        const wtRegistry = stubWorktreeRegistry();
        const wm = stubWorkspaceManager(provider, wtRegistry);
        const executor = new CleanupStepExecutor(provRegistry, wtRegistry, wm);

        const workspaceHandle = new WorkspaceHandle("/fake/ws1", new Date());
        const context = new FlowContext({
          results: new Map(),
          prompt: "task",
          workspaces: new Map([["ws1", workspaceHandle]]),
        });

        const instruction: CleanupInstruction = { type: "cleanup", id: "c1", of: "ws1" };

        const eventBus = makeMockTypedEventBus();
        await executor.execute(instruction, context, vi.fn(), eventBus);

        expect(eventBus.raw.emit).toHaveBeenCalledTimes(2);
        expect(eventBus.raw.emit).toHaveBeenNthCalledWith(
          1,
          "feature-forge:cleanup-start",
          expect.objectContaining({
            phase: "cleanup-start",
            message: expect.stringContaining("c1") as string,
          }),
        );
        expect(eventBus.raw.emit).toHaveBeenNthCalledWith(
          2,
          "feature-forge:cleanup-done",
          expect.objectContaining({
            phase: "cleanup-done",
            message: expect.stringContaining("c1") as string,
            details: expect.objectContaining({
              workspace: expect.any(String),
            }),
          }),
        );
      });

      it("works with a mocked eventBus", async () => {
        const provider = new TrackingProvider();
        const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
        const wtRegistry = stubWorktreeRegistry();
        const wm = stubWorkspaceManager(provider, wtRegistry);
        const executor = new CleanupStepExecutor(provRegistry, wtRegistry, wm);

        const workspaceHandle = new WorkspaceHandle("/fake/ws1", new Date());
        const context = new FlowContext({
          results: new Map(),
          prompt: "task",
          workspaces: new Map([["ws1", workspaceHandle]]),
        });

        const instruction: CleanupInstruction = { type: "cleanup", id: "c1", of: "ws1" };

        const result = await executor.execute(
          instruction,
          context,
          vi.fn(),
          makeMockTypedEventBus(),
        );

        expect(result.results.get("c1")!.parsed!.passed).toBe(true);
      });
    });

    it("treats of as a raw path when not found in workspaces", async () => {
      const provider = new TrackingProvider();
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const wtRegistry = stubWorktreeRegistry();
      const wm = stubWorkspaceManager(provider, wtRegistry);
      const executor = new CleanupStepExecutor(provRegistry, wtRegistry, wm);

      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
        workspaces: new Map(),
      });

      const instruction: CleanupInstruction = { type: "cleanup", id: "c1", of: "/raw/path" };
      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(provider.destroyedPaths).toContain("/raw/path");
      expect(result.results.get("c1")!.parsed!.passed).toBe(true);
    });

    it("finds branch by path when handle not found by name", async () => {
      const provider = new TrackingProvider();
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const wtRegistry = stubWorktreeRegistry();
      const wm = stubWorkspaceManager(provider, wtRegistry);
      const executor = new CleanupStepExecutor(provRegistry, wtRegistry, wm);

      const handle = new WorkspaceHandle("/fake/ws-def", new Date(), "forge/ws-def");
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
        workspaces: new Map([["ws", handle]]),
      });

      const instruction: CleanupInstruction = { type: "cleanup", id: "c1", of: "/fake/ws-def" };
      await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(provider.destroyedPaths).toContain("/fake/ws-def");
      expect(provider.destroyedBranches).toContain("forge/ws-def");
    });

    it("destroys workspace with registered provider", async () => {
      const goodProvider = new TrackingProvider();
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", goodProvider);
      const wtRegistry = stubWorktreeRegistry();
      const wm = stubWorkspaceManager(goodProvider, wtRegistry);
      const executor = new CleanupStepExecutor(provRegistry, wtRegistry, wm);

      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
        workspaces: new Map([["ws1", new WorkspaceHandle("/fake/ws1", new Date())]]),
      });

      const instruction: CleanupInstruction = { type: "cleanup", id: "c1", of: "ws1" };
      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(goodProvider.destroyedPaths).toContain("/fake/ws1");
      expect(result.results.get("c1")!.parsed!.passed).toBe(true);
    });
  });
});
