import { describe, expect, it, vi } from "vitest";

import { makeMockEventBus } from "../../test-utils";
import type { CreateWorkspaceOptions } from "../../workspace/WorkspaceProvider";
import { WorkspaceProvider } from "../../workspace/WorkspaceProvider";
import { WorkspaceProviderRegistry } from "../../workspace/WorkspaceProviderRegistry";
import { WorktreeRegistry } from "../../workspace/WorktreeRegistry";
import { FlowContext } from "../FlowContext";
import type { WorkspaceInstruction } from "../FlowInstruction";
import { createMutableState } from "../progress/AccumulatedState";
import type { DisplayContribution, WorkspaceContribution } from "../progress/DisplayContribution";
import { DisplayContributionRegistry } from "../progress/DisplayContributionRegistry";
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
    await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

    expect(createSpy).toHaveBeenCalledWith(expect.stringContaining("ws-"), {
      symlinks: ["custom-dir", "another-dir"],
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
            branch: expect.stringContaining("forge/ws-") as string,
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

  describe("getDisplayContribution", () => {
    function getWorkspace(
      executor: WorkspaceStepExecutor,
      event: RoutineProgressEvent,
    ): WorkspaceContribution | undefined {
      return executor.getDisplayContribution(event) as WorkspaceContribution | undefined;
    }

    it("returns contribution with workspace and branch from workspace-ready event", () => {
      const executor = new WorkspaceStepExecutor(
        new WorkspaceProviderRegistry(),
        stubWorktreeRegistry(),
      );

      const contribution = getWorkspace(executor, {
        phase: "workspace-ready",
        message: "Workspace created",
        details: { workspace: "/test/ws-abc", branch: "forge/ws-abc" },
      });

      expect(contribution).toBeDefined();
      expect(contribution!.workspace).toBe("/test/ws-abc");
      expect(contribution!.branch).toBe("forge/ws-abc");
      expect(contribution!.phase).toBe("workspace-ready");
      expect(contribution!.message).toBe("Workspace created");
    });

    it("returns undefined for non-workspace-ready events", () => {
      const executor = new WorkspaceStepExecutor(
        new WorkspaceProviderRegistry(),
        stubWorktreeRegistry(),
      );

      const event: RoutineProgressEvent = {
        phase: "agent-started",
        message: "Agent started",
        details: {},
      };

      expect(executor.getDisplayContribution(event)).toBeUndefined();
    });

    it("returns undefined when workspace is not a string", () => {
      const executor = new WorkspaceStepExecutor(
        new WorkspaceProviderRegistry(),
        stubWorktreeRegistry(),
      );

      const event: RoutineProgressEvent = {
        phase: "workspace-ready",
        message: "Workspace created",
        details: {},
      };

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
      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      const handle = result.workspaces.get("ws");
      expect(handle).toBeDefined();
      expect(handle!.branch).toBe(`forge/ws-00000000`);
    });
  });

  describe("registerDisplayHandler", () => {
    it("registers a 'workspace' handler that updates workspacePath and branch", () => {
      const executor = new WorkspaceStepExecutor(
        new WorkspaceProviderRegistry(),
        stubWorktreeRegistry(),
      );
      const registry = new DisplayContributionRegistry();

      executor.registerDisplayHandler(registry);

      expect(registry.has("workspace")).toBe(true);

      const contributions: DisplayContribution[] = [
        { type: "workspace", workspace: "/tmp/ws-1", branch: "forge/ws-1" },
        { type: "workspace", workspace: "/tmp/ws-2", branch: "forge/ws-2" },
      ];

      const state = createMutableState();
      registry.apply(state, contributions);

      expect(state.workspacePath).toBe("/tmp/ws-2");
      expect(state.branch).toBe("forge/ws-2");
    });

    it("updates workspacePath even when branch is undefined", () => {
      const executor = new WorkspaceStepExecutor(
        new WorkspaceProviderRegistry(),
        stubWorktreeRegistry(),
      );
      const registry = new DisplayContributionRegistry();

      executor.registerDisplayHandler(registry);

      const contributions: DisplayContribution[] = [{ type: "workspace", workspace: "/tmp/ws-1" }];

      const state = createMutableState();
      registry.apply(state, contributions);

      expect(state.workspacePath).toBe("/tmp/ws-1");
      expect(state.branch).toBeUndefined();
    });

    it("does not update non-workspace fields", () => {
      const executor = new WorkspaceStepExecutor(
        new WorkspaceProviderRegistry(),
        stubWorktreeRegistry(),
      );
      const registry = new DisplayContributionRegistry();

      executor.registerDisplayHandler(registry);

      const contributions: DisplayContribution[] = [
        { type: "agent", agentId: "a1", agentStatus: "done" },
      ];

      const state = createMutableState();
      registry.apply(state, contributions);

      expect(state.workspacePath).toBeUndefined();
      expect(state.branch).toBeUndefined();
    });
  });
});
