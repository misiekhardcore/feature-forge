import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it } from "vitest";

import { InMemoryAgentSupervisor } from "../agents/supervisors";
import {
  makeMockCtx,
  makeMockFactory,
  makeMockPi,
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
      cmd = new WorktreeListCommand(supervisor, pi);
    });

    it("notifies error when workspace infrastructure is not configured", async () => {
      await cmd.handler("", ctx as unknown as ExtensionCommandContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "Workspace infrastructure is not configured.",
        "error",
      );
    });
  });

  describe("with workspace manager", () => {
    beforeEach(() => {
      cmd = new WorktreeListCommand(supervisor, pi, makeWorkspaceManager());
    });

    it("notifies when no active worktrees exist", async () => {
      await cmd.handler("", ctx as unknown as ExtensionCommandContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith("No active worktrees.", "info");
    });

    it("sends a message listing active worktrees", async () => {
      const manager = makeWorkspaceManager();
      await manager.create("task-1");
      await manager.create("task-2");
      cmd = new WorktreeListCommand(supervisor, pi, manager);

      await cmd.handler("", ctx as unknown as ExtensionCommandContext);

      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customType: "worktree_list",
          display: true,
        }),
        { triggerTurn: false },
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
      cmd = new WorktreeDestroyCommand(supervisor, pi);
    });

    it("notifies error when workspace infrastructure is not configured", async () => {
      await cmd.handler("some-id", ctx as unknown as ExtensionCommandContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "Workspace infrastructure is not configured.",
        "error",
      );
    });
  });

  describe("with workspace manager", () => {
    beforeEach(() => {
      cmd = new WorktreeDestroyCommand(supervisor, pi, makeWorkspaceManager());
    });

    it("notifies error when args is empty", async () => {
      await cmd.handler("", ctx as unknown as ExtensionCommandContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /worktree:destroy <id>", "error");
    });

    it("notifies error when args is whitespace", async () => {
      await cmd.handler("   ", ctx as unknown as ExtensionCommandContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /worktree:destroy <id>", "error");
    });

    it("notifies error for unknown worktree id", async () => {
      await cmd.handler("unknown-id", ctx as unknown as ExtensionCommandContext);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        'No worktree found with id "unknown-id". Use /worktree:list to see active ones.',
        "error",
      );
    });

    it("destroys an existing worktree and sends a message", async () => {
      const manager = makeWorkspaceManager();
      await manager.create("task-1");
      cmd = new WorktreeDestroyCommand(supervisor, pi, manager);

      await cmd.handler("task-1", ctx as unknown as ExtensionCommandContext);

      expect(ctx.ui.notify).toHaveBeenCalledWith('Worktree "task-1" destroyed.', "info");
      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customType: "worktree_destroyed",
          display: true,
        }),
        { triggerTurn: false },
      );
      expect(manager.get("task-1")).toBeUndefined();
    });

    it("notifies error when manager.destroy throws", async () => {
      const manager = makeWorkspaceManager();
      await manager.create("task-1");
      // Simulate destroy failure
      const originalDestroy = manager.destroy.bind(manager);
      manager.destroy = async (id: string) => {
        if (id === "task-1") throw new Error("cleanup failure");
        return originalDestroy(id);
      };
      cmd = new WorktreeDestroyCommand(supervisor, pi, manager);

      await cmd.handler("task-1", ctx as unknown as ExtensionCommandContext);

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        'Failed to destroy worktree "task-1": cleanup failure',
        "error",
      );
    });
  });
});
