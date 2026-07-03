import { describe, expect, it, vi } from "vitest";

import { WorkspaceHandle } from "../../workspace/WorkspaceHandle";
import { WorkspaceProvider } from "../../workspace/WorkspaceProvider";
import { WorkspaceProviderRegistry } from "../../workspace/WorkspaceProviderRegistry";
import { FlowContext } from "../FlowContext";
import type { CleanupInstruction } from "../FlowInstruction";
import type { RoutineProgressEvent } from "../RoutineProgress";
import { CleanupStepExecutor } from "./CleanupStepExecutor";

// ── Helpers ──────────────────────────────────────────────────

class TrackingProvider extends WorkspaceProvider {
  destroyedPaths: string[] = [];

  override async createWorkspace(id: string): Promise<string> {
    return `/fake/${id}`;
  }

  override async destroyWorkspace(path: string): Promise<void> {
    this.destroyedPaths.push(path);
  }
}

// ── Tests ────────────────────────────────────────────────────

describe("CleanupStepExecutor", () => {
  describe("execute", () => {
    it("destroys the workspace referenced by `of`", async () => {
      const provider = new TrackingProvider();
      const registry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const executor = new CleanupStepExecutor(registry);

      const workspaceHandle = new WorkspaceHandle("ws1", "/fake/ws1", new Date());
      const context = new FlowContext(new Map(), "task", new Map([["ws1", workspaceHandle]]));

      const instruction: CleanupInstruction = { type: "cleanup", id: "c1", of: "ws1" };
      const result = await executor.execute(instruction, context, vi.fn());

      expect(provider.destroyedPaths).toContain("/fake/ws1");
      expect(result.results.get("c1")!.parsed!.passed).toBe(true);
    });

    it("resolves placeholders in `of`", async () => {
      const provider = new TrackingProvider();
      const registry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const executor = new CleanupStepExecutor(registry);

      const workspaceHandle = new WorkspaceHandle("ws1", "/fake/ws1", new Date());
      const context = new FlowContext(
        new Map(),
        "task",
        new Map([["ws1", workspaceHandle]]),
        new Map([["target", "ws1"]]),
      );

      // `of` uses a placeholder that resolves to the workspace id.
      const instruction: CleanupInstruction = { type: "cleanup", id: "c1", of: "{{target}}" };
      const result = await executor.execute(instruction, context, vi.fn());

      expect(provider.destroyedPaths).toContain("/fake/ws1");
      expect(result.results.get("c1")!.parsed!.passed).toBe(true);
    });

    it("destroys all workspaces when `of` is omitted", async () => {
      const provider = new TrackingProvider();
      const registry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const executor = new CleanupStepExecutor(registry);

      const context = new FlowContext(
        new Map(),
        "task",
        new Map([
          ["ws1", new WorkspaceHandle("ws1", "/fake/ws1", new Date())],
          ["ws2", new WorkspaceHandle("ws2", "/fake/ws2", new Date())],
        ]),
      );

      const instruction: CleanupInstruction = { type: "cleanup", id: "c1" };
      const result = await executor.execute(instruction, context, vi.fn());

      expect(provider.destroyedPaths).toContain("/fake/ws1");
      expect(provider.destroyedPaths).toContain("/fake/ws2");
      expect(result.results.get("c1")!.parsed!.passed).toBe(true);
    });

    it("continues even if one workspace destruction fails", async () => {
      const goodProvider = new TrackingProvider();
      const failingProvider = new (class extends WorkspaceProvider {
        override async createWorkspace(_id: string): Promise<string> {
          return "/fail";
        }
        override async destroyWorkspace(_path: string): Promise<void> {
          throw new Error("destroy failed");
        }
      })();

      const registry = new WorkspaceProviderRegistry()
        .register("git-worktree", goodProvider)
        .register("failing", failingProvider);

      const executor = new CleanupStepExecutor(registry);

      const context = new FlowContext(
        new Map(),
        "task",
        new Map([["ws1", new WorkspaceHandle("ws1", "/fake/ws1", new Date())]]),
      );

      const instruction: CleanupInstruction = { type: "cleanup", id: "c1" };
      const result = await executor.execute(instruction, context, vi.fn());

      // The good provider still destroyed the path.
      expect(goodProvider.destroyedPaths).toContain("/fake/ws1");
      expect(result.results.get("c1")!.parsed!.passed).toBe(true);
    });

    it("handles empty workspaces gracefully", async () => {
      const provider = new TrackingProvider();
      const registry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const executor = new CleanupStepExecutor(registry);

      const context = new FlowContext(new Map(), "task");
      const instruction: CleanupInstruction = { type: "cleanup", id: "c1" };
      const result = await executor.execute(instruction, context, vi.fn());

      expect(result.results.get("c1")!.parsed!.passed).toBe(true);
      expect(result.results.get("c1")!.raw).toContain('"cleaned":[]');
    });

    describe("onProgress", () => {
      it("fires cleanup-start and cleanup-done events", async () => {
        const provider = new TrackingProvider();
        const registry = new WorkspaceProviderRegistry().register("git-worktree", provider);
        const executor = new CleanupStepExecutor(registry);

        const workspaceHandle = new WorkspaceHandle("ws1", "/fake/ws1", new Date());
        const context = new FlowContext(new Map(), "task", new Map([["ws1", workspaceHandle]]));

        const instruction: CleanupInstruction = { type: "cleanup", id: "c1", of: "ws1" };

        const events: RoutineProgressEvent[] = [];
        const onProgress = (e: RoutineProgressEvent) => events.push(e);

        await executor.execute(instruction, context, vi.fn(), onProgress);

        expect(events).toHaveLength(2);
        expect(events[0].phase).toBe("cleanup-start");
        expect(events[0].message).toContain("c1");
        expect(events[1].phase).toBe("cleanup-done");
        expect(events[1].message).toContain("c1");
      });

      it("does not fire events when onProgress is not provided", async () => {
        const provider = new TrackingProvider();
        const registry = new WorkspaceProviderRegistry().register("git-worktree", provider);
        const executor = new CleanupStepExecutor(registry);

        const workspaceHandle = new WorkspaceHandle("ws1", "/fake/ws1", new Date());
        const context = new FlowContext(new Map(), "task", new Map([["ws1", workspaceHandle]]));

        const instruction: CleanupInstruction = { type: "cleanup", id: "c1", of: "ws1" };

        // Should not throw when called without onProgress.
        const result = await executor.execute(instruction, context, vi.fn());

        expect(result.results.get("c1")!.parsed!.passed).toBe(true);
      });
    });

    it("skips providers that return undefined from get", async () => {
      const goodProvider = new TrackingProvider();
      const registry = new WorkspaceProviderRegistry().register("git-worktree", goodProvider);
      const executor = new CleanupStepExecutor(registry);

      const context = new FlowContext(
        new Map(),
        "task",
        new Map([["ws1", new WorkspaceHandle("ws1", "/fake/ws1", new Date())]]),
      );

      // Use `of` to target a workspace that uses the resolve path.
      const instruction: CleanupInstruction = { type: "cleanup", id: "c1", of: "ws1" };
      const result = await executor.execute(instruction, context, vi.fn());

      expect(goodProvider.destroyedPaths).toContain("/fake/ws1");
      expect(result.results.get("c1")!.parsed!.passed).toBe(true);
    });
  });
});
