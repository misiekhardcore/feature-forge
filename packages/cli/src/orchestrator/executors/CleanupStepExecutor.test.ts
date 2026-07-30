import type { DisplayContribution } from "@feature-forge/tui";
import { createAccumulatedState, DisplayContributionRegistry } from "@feature-forge/tui";
import { describe, expect, it, vi } from "vitest";

import { makeMockTypedEventBus } from "../../test-utils";
import { WorkspaceHandle } from "../../workspace/WorkspaceHandle";
import { WorkspaceManager } from "../../workspace/WorkspaceManager";
import type { CreateWorkspaceOptions } from "../../workspace/WorkspaceProvider";
import { WorkspaceProvider } from "../../workspace/WorkspaceProvider";
import { WorkspaceProviderRegistry } from "../../workspace/WorkspaceProviderRegistry";
import { WorktreeRegistry } from "../../workspace/WorktreeRegistry";
import { FlowContext } from "../FlowContext";
import type { CleanupInstruction } from "../FlowInstruction";
import type { RoutineProgressEvent } from "../RoutineProgress";
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

  describe("getDisplayContribution", () => {
    it("returns phase, message, and workspace from cleanup-done event", () => {
      const executor = new CleanupStepExecutor(
        new WorkspaceProviderRegistry(),
        stubWorktreeRegistry(),
        undefined as unknown as WorkspaceManager,
      );

      const event = {
        phase: "cleanup-done",
        message: "Cleanup completed",
        details: { workspace: "/fake/ws1", executionId: "" },
      } satisfies RoutineProgressEvent;

      const contribution = executor.getDisplayContribution(event);

      expect(contribution).toBeDefined();
      expect(contribution!.phase).toBe("cleanup-done");
      expect(contribution!.message).toBe("Cleanup completed");
      const statusContrib = contribution! as DisplayContribution & { workspace?: string };
      expect(statusContrib.workspace).toBe("/fake/ws1");
    });

    it("returns contribution without workspace when details have none", () => {
      const executor = new CleanupStepExecutor(
        new WorkspaceProviderRegistry(),
        stubWorktreeRegistry(),
        undefined as unknown as WorkspaceManager,
      );

      const event = {
        phase: "cleanup-done",
        message: "No workspaces cleaned",
        details: {},
      } satisfies RoutineProgressEvent;

      const contribution = executor.getDisplayContribution(event);

      expect(contribution).toBeDefined();
      expect(contribution!.phase).toBe("cleanup-done");
      expect(contribution!.message).toBe("No workspaces cleaned");
      const statusContrib = contribution! as DisplayContribution & { workspace?: string };
      expect(statusContrib.workspace).toBeUndefined();
    });

    it("returns undefined for non-cleanup-done events", () => {
      const executor = new CleanupStepExecutor(
        new WorkspaceProviderRegistry(),
        stubWorktreeRegistry(),
        undefined as unknown as WorkspaceManager,
      );

      const event: RoutineProgressEvent = {
        phase: "cleanup-start",
        message: "Cleanup starting",
        details: {},
      };

      expect(executor.getDisplayContribution(event)).toBeUndefined();
    });

    it("returns undefined for unrelated events", () => {
      const executor = new CleanupStepExecutor(
        new WorkspaceProviderRegistry(),
        stubWorktreeRegistry(),
        undefined as unknown as WorkspaceManager,
      );

      const event = {
        phase: "agent-started",
        message: "Agent started",
        details: { agentId: "", executionId: "" },
      } satisfies RoutineProgressEvent;

      expect(executor.getDisplayContribution(event)).toBeUndefined();
    });
  });

  describe("registerDisplayHandler", () => {
    it("registers a cleanup handler that updates workspace in accumulated state", () => {
      const executor = new CleanupStepExecutor(
        new WorkspaceProviderRegistry(),
        stubWorktreeRegistry(),
        undefined as unknown as WorkspaceManager,
      );
      const registry = new DisplayContributionRegistry();
      executor.registerDisplayHandler(registry);

      const state = createAccumulatedState();
      registry.apply(state, [
        { type: "status", workspace: "/tmp/ws-123", phase: "cleanup-done", message: "done" },
      ]);

      expect(state.workspace).toBe("/tmp/ws-123");
    });

    it("does not set workspace when contribution has no workspace field", () => {
      const executor = new CleanupStepExecutor(
        new WorkspaceProviderRegistry(),
        stubWorktreeRegistry(),
        undefined as unknown as WorkspaceManager,
      );
      const registry = new DisplayContributionRegistry();
      executor.registerDisplayHandler(registry);

      const state = createAccumulatedState();
      registry.apply(state, [{ type: "status", phase: "cleanup-done", message: "done" }]);

      expect(state.workspace).toBeUndefined();
    });
  });
});
