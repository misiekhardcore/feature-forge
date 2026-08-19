import {
  makeMockCtx,
  makeMockFactory,
  makeMockPi,
  makeMockSpecManager,
  makeMockToolRegistry,
  MockWorkspaceProvider,
  MockWorktreeRegistry,
} from "@feature-forge/cli/src/test-utils";
import { InMemoryAgentSupervisor } from "@feature-forge/core/src/agents/supervisors";
import { WorkspaceManager } from "@feature-forge/core/src/workspace/WorkspaceManager";
import { ReconciliationReport } from "@feature-forge/core/src/workspace/WorktreeRegistry";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorktreePruneCommand } from "./WorktreePruneCommand";

const pi = makeMockPi();

// Mock fs (for rmSync) and child_process (for git branch -D)
vi.mock("node:fs", () => ({
  rmSync: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual, execFile: vi.fn() };
});

import { execFile } from "node:child_process";
import { rmSync } from "node:fs";

function makeCleanReport(): ReconciliationReport {
  return { staleRegistryEntries: [], orphanedWorktrees: [], orphanedBranches: [] };
}

function makeStaleReport(overrides: Partial<ReconciliationReport> = {}): ReconciliationReport {
  return {
    staleRegistryEntries: ["/tmp/stale-1", "/tmp/stale-2"],
    orphanedWorktrees: ["/tmp/orphan-1"],
    orphanedBranches: ["forge/orphan-branch"],
    ...overrides,
  };
}

describe("WorktreePruneCommand", () => {
  let supervisor: InMemoryAgentSupervisor;
  let cmd: WorktreePruneCommand;
  let ctx: ReturnType<typeof makeMockCtx>;
  let registry: MockWorktreeRegistry;
  let manager: WorkspaceManager;

  beforeEach(() => {
    vi.clearAllMocks();
    supervisor = new InMemoryAgentSupervisor(makeMockFactory());
    ctx = makeMockCtx();
    registry = new MockWorktreeRegistry();
    manager = new WorkspaceManager(new MockWorkspaceProvider(), registry);
  });

  function makeCommand(): WorktreePruneCommand {
    return new WorktreePruneCommand({
      supervisor,
      pi,
      specManager: makeMockSpecManager(),
      toolRegistry: makeMockToolRegistry(),
      workspaceManager: manager,
      worktreeRegistry: registry,
    });
  }

  describe("command metadata", () => {
    beforeEach(() => {
      cmd = makeCommand();
    });

    it("has name 'worktree:prune'", () => {
      expect(cmd.name).toBe("worktree:prune");
    });

    it("has a description", () => {
      expect(cmd.description).toContain("Prune stale worktrees");
    });
  });

  describe("without workspace manager or registry", () => {
    beforeEach(() => {
      cmd = new WorktreePruneCommand({
        supervisor,
        pi,
        specManager: makeMockSpecManager(),
        toolRegistry: makeMockToolRegistry(),
      });
    });

    it("notifies error when workspace infrastructure is not configured", async () => {
      await cmd.handler("", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "Workspace infrastructure is not configured.",
        "error",
      );
    });
  });

  describe("list mode (no --sweep)", () => {
    beforeEach(() => {
      cmd = makeCommand();
      // Override reconcile on the MockWorktreeRegistry instance.
      vi.spyOn(registry, "reconcile").mockResolvedValue(makeCleanReport());
    });

    it("reports clean state when no stale items", async () => {
      await cmd.handler("", ctx);
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "✨ No stale items — everything is clean.",
        "info",
      );
    });

    it("reports stale registry entries", async () => {
      vi.spyOn(registry, "reconcile").mockResolvedValue(
        makeStaleReport({ orphanedWorktrees: [], orphanedBranches: [] }),
      );

      await cmd.handler("", ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("📋 Reconciliation Report:"),
        "info",
      );
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("Stale registry entries (2):"),
        "info",
      );
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("/tmp/stale-1"), "info");
    });

    it("reports orphaned worktrees", async () => {
      vi.spyOn(registry, "reconcile").mockResolvedValue(
        makeStaleReport({ staleRegistryEntries: [], orphanedBranches: [] }),
      );

      await cmd.handler("", ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("Orphaned worktrees (1):"),
        "info",
      );
    });

    it("reports orphaned branches", async () => {
      vi.spyOn(registry, "reconcile").mockResolvedValue(
        makeStaleReport({ staleRegistryEntries: [], orphanedWorktrees: [] }),
      );

      await cmd.handler("", ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("Orphaned branches (1):"),
        "info",
      );
    });

    it("shows cleanup hint with total count", async () => {
      vi.spyOn(registry, "reconcile").mockResolvedValue(makeStaleReport());

      await cmd.handler("", ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("Run /forge:worktree:prune --sweep to clean up 4 item(s)."),
        "info",
      );
    });
  });

  describe("sweep mode (--sweep)", () => {
    beforeEach(() => {
      cmd = makeCommand();
    });

    it("reports clean state when nothing to prune", async () => {
      vi.spyOn(registry, "reconcile").mockResolvedValue(makeCleanReport());

      await cmd.handler("--sweep", ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        "✨ Nothing to prune — worktree state is clean.",
        "info",
      );
    });

    it("performs cleanup with stale registry entries", async () => {
      vi.spyOn(registry, "reconcile").mockResolvedValue(
        makeStaleReport({ orphanedWorktrees: [], orphanedBranches: [] }),
      );
      const destroySpy = vi.spyOn(manager, "destroy").mockResolvedValue(undefined);

      await cmd.handler("--sweep", ctx);

      expect(destroySpy).toHaveBeenCalledTimes(2);
      expect(destroySpy).toHaveBeenCalledWith("/tmp/stale-1");
      expect(destroySpy).toHaveBeenCalledWith("/tmp/stale-2");
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("🧹 Prune complete:"),
        "info",
      );
    });

    it("handles manager.destroy errors gracefully", async () => {
      vi.spyOn(registry, "reconcile").mockResolvedValue(
        makeStaleReport({ orphanedWorktrees: [], orphanedBranches: [] }),
      );
      vi.spyOn(manager, "destroy").mockRejectedValue(new Error("cleanup failure"));

      await cmd.handler("--sweep", ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("Failed to remove stale registry entry"),
        "error",
      );
    });

    it("removes orphaned worktree directories and deletes forge branch", async () => {
      vi.spyOn(registry, "reconcile").mockResolvedValue(
        makeStaleReport({ staleRegistryEntries: [], orphanedBranches: [] }),
      );
      vi.mocked(rmSync).mockImplementation(() => undefined);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (execFile as any).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
        cb(null, "", "");
      });

      await cmd.handler("--sweep", ctx);

      expect(rmSync).toHaveBeenCalledWith("/tmp/orphan-1", {
        recursive: true,
        force: true,
      });
      expect(execFile).toHaveBeenCalledWith(
        "git",
        ["branch", "-D", "forge/orphan-1"],
        { cwd: process.cwd() },
        expect.any(Function),
      );
    });

    it("handles rmSync failure and skips branch deletion", async () => {
      vi.spyOn(registry, "reconcile").mockResolvedValue(
        makeStaleReport({ staleRegistryEntries: [], orphanedBranches: [] }),
      );
      vi.mocked(rmSync).mockImplementation(() => {
        throw new Error("permission denied");
      });

      await cmd.handler("--sweep", ctx);

      expect(execFile).not.toHaveBeenCalled();
      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("❌ Failed to remove orphaned worktree"),
        "error",
      );
    });

    it("deletes orphaned branches", async () => {
      vi.spyOn(registry, "reconcile").mockResolvedValue(
        makeStaleReport({ staleRegistryEntries: [], orphanedWorktrees: [] }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (execFile as any).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
        cb(null, "", "");
      });

      await cmd.handler("--sweep", ctx);

      expect(execFile).toHaveBeenCalledWith(
        "git",
        ["branch", "-D", "forge/orphan-branch"],
        { cwd: process.cwd() },
        expect.any(Function),
      );
    });

    it("skips branch in orphanedBranches if already deleted via orphaned worktree", async () => {
      // Simulate overlap: an orphaned worktree whose derived branch name
      // also appears in orphanedBranches.
      vi.spyOn(registry, "reconcile").mockResolvedValue(
        makeStaleReport({
          staleRegistryEntries: [],
          orphanedWorktrees: ["/tmp/forge/overlap-dir"],
          orphanedBranches: ["forge/overlap-dir"],
        }),
      );
      vi.mocked(rmSync).mockImplementation(() => undefined);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (execFile as any).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
        cb(null, "", "");
      });

      await cmd.handler("--sweep", ctx);

      // execFile should be called exactly once — the second call (from
      // the orphanedBranches loop) should be skipped since the branch was
      // already deleted in the orphanedWorktrees loop.
      expect(execFile).toHaveBeenCalledTimes(1);
      expect(execFile).toHaveBeenCalledWith(
        "git",
        ["branch", "-D", "forge/overlap-dir"],
        { cwd: process.cwd() },
        expect.any(Function),
      );
    });

    it("handles branch deletion failure gracefully", async () => {
      vi.spyOn(registry, "reconcile").mockResolvedValue(
        makeStaleReport({ staleRegistryEntries: [], orphanedWorktrees: [] }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (execFile as any).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
        cb(new Error("branch not found"), "", "");
      });

      await cmd.handler("--sweep", ctx);

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("❌ Failed to delete branch"),
        "error",
      );
    });
  });
});
