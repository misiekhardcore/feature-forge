import { describe, expect, it, vi } from "vitest";

import { makeMockEventBus } from "../../test-utils";
import { WorkspaceHandle } from "../../workspace/WorkspaceHandle";
import type { CreateWorkspaceOptions } from "../../workspace/WorkspaceProvider";
import { WorkspaceProvider } from "../../workspace/WorkspaceProvider";
import { WorkspaceProviderRegistry } from "../../workspace/WorkspaceProviderRegistry";
import { WorktreeRegistry } from "../../workspace/WorktreeRegistry";
import { FlowContext } from "../FlowContext";
import type { CleanupInstruction } from "../FlowInstruction";
import { CleanupStepExecutor } from "./CleanupStepExecutor";

// ── Helpers ──────────────────────────────────────────────────

class TrackingProvider extends WorkspaceProvider {
  destroyedPaths: string[] = [];

  override async createWorkspace(id: string, _options?: CreateWorkspaceOptions): Promise<string> {
    return `/fake/${id}`;
  }

  override async destroyWorkspace(path: string): Promise<void> {
    this.destroyedPaths.push(path);
  }
}

function stubWorktreeRegistry(): WorktreeRegistry {
  const registry = new WorktreeRegistry();
  return registry;
}

// ── Tests ────────────────────────────────────────────────────

describe("CleanupStepExecutor", () => {
  describe("execute", () => {
    it("throws AbortError when signal is aborted at entry", async () => {
      const provider = new TrackingProvider();
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const wtRegistry = stubWorktreeRegistry();
      const executor = new CleanupStepExecutor(provRegistry, wtRegistry);

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
        executor.execute(instruction, context, vi.fn(), makeMockEventBus(), controller.signal),
      ).rejects.toThrow();

      // No workspace was destroyed.
      expect(provider.destroyedPaths).toHaveLength(0);
    });

    it("destroys the workspace referenced by `of`", async () => {
      const provider = new TrackingProvider();
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const wtRegistry = stubWorktreeRegistry();
      const executor = new CleanupStepExecutor(provRegistry, wtRegistry);

      const workspaceHandle = new WorkspaceHandle("/fake/ws1", new Date());
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
        workspaces: new Map([["ws1", workspaceHandle]]),
      });

      const instruction: CleanupInstruction = { type: "cleanup", id: "c1", of: "ws1" };
      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      expect(provider.destroyedPaths).toContain("/fake/ws1");
      expect(result.results.get("c1")!.parsed!.passed).toBe(true);
    });

    it("resolves placeholders in `of`", async () => {
      const provider = new TrackingProvider();
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const wtRegistry = stubWorktreeRegistry();
      const executor = new CleanupStepExecutor(provRegistry, wtRegistry);

      const workspaceHandle = new WorkspaceHandle("/fake/ws1", new Date());
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
        workspaces: new Map([["ws1", workspaceHandle]]),
        params: new Map([["target", "ws1"]]),
      });

      const instruction: CleanupInstruction = { type: "cleanup", id: "c1", of: "{{target}}" };
      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      expect(provider.destroyedPaths).toContain("/fake/ws1");
      expect(result.results.get("c1")!.parsed!.passed).toBe(true);
    });

    it("destroys all workspaces when `of` is omitted", async () => {
      const provider = new TrackingProvider();
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const wtRegistry = stubWorktreeRegistry();
      const executor = new CleanupStepExecutor(provRegistry, wtRegistry);

      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
        workspaces: new Map([
          ["ws1", new WorkspaceHandle("/fake/ws1", new Date())],
          ["ws2", new WorkspaceHandle("/fake/ws2", new Date())],
        ]),
      });

      const instruction: CleanupInstruction = { type: "cleanup", id: "c1" };
      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      expect(provider.destroyedPaths).toContain("/fake/ws1");
      expect(provider.destroyedPaths).toContain("/fake/ws2");
      expect(result.results.get("c1")!.parsed!.passed).toBe(true);
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
        override async destroyWorkspace(_path: string): Promise<void> {
          throw new Error("destroy failed");
        }
      })();

      const provRegistry = new WorkspaceProviderRegistry()
        .register("git-worktree", goodProvider)
        .register("failing", failingProvider);

      const wtRegistry = stubWorktreeRegistry();
      const executor = new CleanupStepExecutor(provRegistry, wtRegistry);

      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
        workspaces: new Map([["ws1", new WorkspaceHandle("/fake/ws1", new Date())]]),
      });

      const instruction: CleanupInstruction = { type: "cleanup", id: "c1" };
      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      expect(goodProvider.destroyedPaths).toContain("/fake/ws1");
      expect(result.results.get("c1")!.parsed!.passed).toBe(true);
    });

    it("handles empty workspaces gracefully", async () => {
      const provider = new TrackingProvider();
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const wtRegistry = stubWorktreeRegistry();
      const executor = new CleanupStepExecutor(provRegistry, wtRegistry);

      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
      });
      const instruction: CleanupInstruction = { type: "cleanup", id: "c1" };
      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      expect(result.results.get("c1")!.parsed!.passed).toBe(true);
      expect(result.results.get("c1")!.raw).toContain('"cleaned":[]');
    });

    describe("eventBus", () => {
      it("emits cleanup-start and cleanup-done events", async () => {
        const provider = new TrackingProvider();
        const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
        const wtRegistry = stubWorktreeRegistry();
        const executor = new CleanupStepExecutor(provRegistry, wtRegistry);

        const workspaceHandle = new WorkspaceHandle("/fake/ws1", new Date());
        const context = new FlowContext({
          results: new Map(),
          prompt: "task",
          workspaces: new Map([["ws1", workspaceHandle]]),
        });

        const instruction: CleanupInstruction = { type: "cleanup", id: "c1", of: "ws1" };

        const eventBus = makeMockEventBus();
        await executor.execute(instruction, context, vi.fn(), eventBus);

        expect(eventBus.emit).toHaveBeenCalledTimes(2);
        expect(eventBus.emit).toHaveBeenNthCalledWith(
          1,
          "feature-forge:cleanup-start",
          expect.objectContaining({
            phase: "cleanup-start",
            message: expect.stringContaining("c1") as string,
          }),
        );
        expect(eventBus.emit).toHaveBeenNthCalledWith(
          2,
          "feature-forge:cleanup-done",
          expect.objectContaining({
            phase: "cleanup-done",
            message: expect.stringContaining("c1") as string,
          }),
        );
      });

      it("works with a mocked eventBus", async () => {
        const provider = new TrackingProvider();
        const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
        const wtRegistry = stubWorktreeRegistry();
        const executor = new CleanupStepExecutor(provRegistry, wtRegistry);

        const workspaceHandle = new WorkspaceHandle("/fake/ws1", new Date());
        const context = new FlowContext({
          results: new Map(),
          prompt: "task",
          workspaces: new Map([["ws1", workspaceHandle]]),
        });

        const instruction: CleanupInstruction = { type: "cleanup", id: "c1", of: "ws1" };

        const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

        expect(result.results.get("c1")!.parsed!.passed).toBe(true);
      });
    });

    it("treats of as a raw path when not found in workspaces", async () => {
      const provider = new TrackingProvider();
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const wtRegistry = stubWorktreeRegistry();
      const executor = new CleanupStepExecutor(provRegistry, wtRegistry);

      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
        workspaces: new Map(),
      });

      const instruction: CleanupInstruction = { type: "cleanup", id: "c1", of: "/raw/path" };
      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      expect(provider.destroyedPaths).toContain("/raw/path");
      expect(result.results.get("c1")!.parsed!.passed).toBe(true);
    });

    it("skips providers that return undefined from get", async () => {
      const goodProvider = new TrackingProvider();
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", goodProvider);
      const wtRegistry = stubWorktreeRegistry();
      const executor = new CleanupStepExecutor(provRegistry, wtRegistry);

      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
        workspaces: new Map([["ws1", new WorkspaceHandle("/fake/ws1", new Date())]]),
      });

      const instruction: CleanupInstruction = { type: "cleanup", id: "c1", of: "ws1" };
      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      expect(goodProvider.destroyedPaths).toContain("/fake/ws1");
      expect(result.results.get("c1")!.parsed!.passed).toBe(true);
    });
  });
});
