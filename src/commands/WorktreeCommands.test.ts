import { beforeEach, describe, expect, it } from "vitest";

import { InMemoryAgentSupervisor } from "../agents/supervisors";
import {
  makeMockCtx,
  makeMockFactory,
  makeMockPi,
  makeMockSpecManager,
  MockWorkspaceProvider,
  MockWorktreeRegistry,
} from "../test-utils";
import { WorkspaceManager } from "../workspace/WorkspaceManager";
import { WorktreeDestroyCommand } from "./WorktreeDestroyCommand";
import { WorktreeListCommand } from "./WorktreeListCommand";

const pi = makeMockPi();

function makeWorkspaceManager(): WorkspaceManager {
  return new WorkspaceManager(new MockWorkspaceProvider(), new MockWorktreeRegistry());
}

describe("WorktreeListCommand", () => {
  let supervisor: InMemoryAgentSupervisor;
  let cmd: WorktreeListCommand;
  let ctx: ReturnType<typeof makeMockCtx>;

  beforeEach(() => {
    supervisor = new InMemoryAgentSupervisor(makeMockFactory());
    ctx = makeMockCtx();
  });

  describe("without workspace manager", () => {
    beforeEach(() => {
      cmd = new WorktreeListCommand(supervisor, pi, makeMockSpecManager());
    });

    it("notifies error when workspace infrastructure is not configured", async () => {
      await cmd.handler("", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "Workspace infrastructure is not configured.",
        "error",
      );
    });
  });

  describe("with workspace manager", () => {
    beforeEach(() => {
      cmd = new WorktreeListCommand(supervisor, pi, makeMockSpecManager(), makeWorkspaceManager());
    });

    it("notifies when no active worktrees exist", async () => {
      await cmd.handler("", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith("No active worktrees.", "info");
    });

    it("notifies listing active worktrees", async () => {
      const manager = makeWorkspaceManager();
      await manager.create("task-1");
      await manager.create("task-2");
      cmd = new WorktreeListCommand(supervisor, pi, makeMockSpecManager(), manager);

      await cmd.handler("", ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("Active worktrees (2):"),
        "info",
      );
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("/tmp/mock-workspaces/task-1"),
        "info",
      );
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("/tmp/mock-workspaces/task-2"),
        "info",
      );
    });
  });
});

describe("WorktreeDestroyCommand", () => {
  let supervisor: InMemoryAgentSupervisor;
  let cmd: WorktreeDestroyCommand;
  let ctx: ReturnType<typeof makeMockCtx>;

  beforeEach(() => {
    supervisor = new InMemoryAgentSupervisor(makeMockFactory());
    ctx = makeMockCtx();
  });

  describe("without workspace manager", () => {
    beforeEach(() => {
      cmd = new WorktreeDestroyCommand(supervisor, pi, makeMockSpecManager());
    });

    it("notifies error when workspace infrastructure is not configured", async () => {
      await cmd.handler("some-id", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "Workspace infrastructure is not configured.",
        "error",
      );
    });
  });

  describe("with workspace manager", () => {
    beforeEach(() => {
      cmd = new WorktreeDestroyCommand(
        supervisor,
        pi,
        makeMockSpecManager(),
        makeWorkspaceManager(),
      );
    });

    it("notifies error when args is empty", async () => {
      await cmd.handler("", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /worktree:destroy <path>", "error");
    });

    it("notifies error when args is whitespace", async () => {
      await cmd.handler("   ", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /worktree:destroy <path>", "error");
    });

    it("notifies error for unknown worktree path", async () => {
      await cmd.handler("/unknown/path", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        'No worktree found with path "/unknown/path". Use /worktree:list to see active ones.',
        "error",
      );
    });

    it("destroys an existing worktree and sends a message", async () => {
      const manager = makeWorkspaceManager();
      const handle = await manager.create("task-1");
      cmd = new WorktreeDestroyCommand(supervisor, pi, makeMockSpecManager(), manager);

      await cmd.handler(handle.path, ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith(`Worktree "${handle.path}" destroyed.`, "info");
      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customType: "worktree_destroyed",
          display: true,
        }),
        { triggerTurn: false },
      );
      expect(manager.get(handle.path)).toBeUndefined();
    });

    it("notifies error when manager.destroy throws", async () => {
      const manager = makeWorkspaceManager();
      const handle = await manager.create("task-1");
      const originalDestroy = manager.destroy.bind(manager);
      manager.destroy = async (id: string) => {
        if (id === handle.path) throw new Error("cleanup failure");
        return originalDestroy(id);
      };
      cmd = new WorktreeDestroyCommand(supervisor, pi, makeMockSpecManager(), manager);

      await cmd.handler(handle.path, ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        `Failed to destroy worktree "${handle.path}": cleanup failure`,
        "error",
      );
    });
  });
});
