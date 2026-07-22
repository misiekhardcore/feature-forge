import type { DisplayContribution } from "@feature-forge/tui";
import { createAccumulatedState, DisplayContributionRegistry } from "@feature-forge/tui";
import { describe, expect, it, vi } from "vitest";

import { makeMockTypedEventBus } from "../../test-utils";
import type { CreateWorkspaceOptions } from "../../workspace/WorkspaceProvider";
import { WorkspaceProvider } from "../../workspace/WorkspaceProvider";
import { WorkspaceProviderRegistry } from "../../workspace/WorkspaceProviderRegistry";
import { WorktreeRegistry } from "../../workspace/WorktreeRegistry";
import { FlowContext } from "../FlowContext";
import type { WorkspaceInstruction } from "../FlowInstruction";
import type { RoutineProgressEvent } from "../RoutineProgress";
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
    const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

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
      executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus()),
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
    await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

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
      executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus(), controller.signal),
    ).rejects.toThrow();
  });

  it("passes instruction.symlinks to provider.createWorkspace", async () => {
    const provider = new CountingProvider();
    // Spy on createWorkspace to verify the options passed
    const createSpy = vi.spyOn(provider, "createWorkspace");

    const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
    const wtRegistry = stubWorktreeRegistry();
    const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry);

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
      const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry);

      const instruction: WorkspaceInstruction = {
        type: "workspace",
        id: "ws1",
        provider: "git-worktree",
      };
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(result.workspaces.has("ws")).toBe(true);
    });
  });

  describe("getDisplayContribution", () => {
    it("returns contribution with workspace path and branch from workspace-ready event", () => {
      const executor = new WorkspaceStepExecutor(
        new WorkspaceProviderRegistry(),
        stubWorktreeRegistry(),
      );

      const event = {
        phase: "workspace-ready",
        message: "Workspace created",
        details: { path: "/test/ws-abc", branch: "forge/ws-abc" },
      } as unknown as RoutineProgressEvent;

      const contribution = executor.getDisplayContribution(event);

      expect(contribution).toBeDefined();
      const wsContrib = contribution! as DisplayContribution & {
        workspace: string;
        branch: string;
      };
      expect(wsContrib.workspace).toBe("/test/ws-abc");
      expect(wsContrib.branch).toBe("forge/ws-abc");
      expect(contribution!.phase).toBe("workspace-ready");
      expect(contribution!.message).toBe("Workspace created");
    });

    it("returns undefined for non-workspace-ready events", () => {
      const executor = new WorkspaceStepExecutor(
        new WorkspaceProviderRegistry(),
        stubWorktreeRegistry(),
      );

      const event = {
        phase: "agent-started",
        message: "Agent started",
        details: {},
      } as unknown as RoutineProgressEvent;

      expect(executor.getDisplayContribution(event)).toBeUndefined();
    });

    it("returns undefined when path is not a string", () => {
      const executor = new WorkspaceStepExecutor(
        new WorkspaceProviderRegistry(),
        stubWorktreeRegistry(),
      );

      const event = {
        phase: "workspace-ready",
        message: "Workspace created",
        details: {},
      } as unknown as RoutineProgressEvent;

      expect(executor.getDisplayContribution(event)).toBeUndefined();
    });
  });

  describe("execute — branch", () => {
    it("passes branch to WorkspaceHandle", async () => {
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
      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      const handle = result.workspaces.get("ws");
      expect(handle).toBeDefined();
      expect(handle!.branch).toBe(`forge/ws-00000000`);
    });
    it("uses explicit branch from instruction when provided", async () => {
      const provider = new CountingProvider();
      const createSpy = vi.spyOn(provider, "createWorkspace");
      const provRegistry = new WorkspaceProviderRegistry().register("git-worktree", provider);
      const wtRegistry = stubWorktreeRegistry();
      const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry);

      const instruction: WorkspaceInstruction = {
        type: "workspace",
        id: "ws1",
        provider: "git-worktree",
        branch: "feature/existing-pr",
      };
      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      const handle = result.workspaces.get("ws");
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
      const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry);

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

      const handle = result.workspaces.get("ws");
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
      const executor = new WorkspaceStepExecutor(provRegistry, wtRegistry);

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

      const handle = result.workspaces.get("ws");
      expect(handle!.branch).toBe("forge/ws-00000000");
      expect(createSpy).toHaveBeenCalledWith(expect.stringContaining("ws-"), {
        branch: "forge/ws-00000000",
      });
    });
  });

  describe("registerDisplayHandler", () => {
    it("registers a workspace handler that updates workspace and branch", () => {
      const executor = new WorkspaceStepExecutor(
        new WorkspaceProviderRegistry(),
        new WorktreeRegistry(),
      );
      const registry = new DisplayContributionRegistry();
      executor.registerDisplayHandler(registry);

      const state = createAccumulatedState();
      registry.apply(state, [
        {
          type: "workspace",
          workspace: "/tmp/ws-123",
          branch: "feature/test",
          phase: "test",
          message: "test",
        },
      ]);

      expect(state.workspace).toBe("/tmp/ws-123");
      expect(state.branch).toBe("feature/test");
    });

    it("does not set branch when contribution has no branch field", () => {
      const executor = new WorkspaceStepExecutor(
        new WorkspaceProviderRegistry(),
        new WorktreeRegistry(),
      );
      const registry = new DisplayContributionRegistry();
      executor.registerDisplayHandler(registry);

      const state = createAccumulatedState();
      registry.apply(state, [
        { type: "workspace", workspace: "/tmp/ws-456", phase: "test", message: "test" },
      ]);

      expect(state.workspace).toBe("/tmp/ws-456");
      expect(state.branch).toBeUndefined();
    });
  });
});
