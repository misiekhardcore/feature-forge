import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock setup ───────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const execFile = vi.fn();
  let existsSyncPaths = new Set<string>();
  const existsSync = vi.fn((path: string) => existsSyncPaths.has(path));
  const rmSync = vi.fn();
  /** Maps "cmd::JSON.stringify(args)" → { stdout } | { error, stderr } */
  const execResults = new Map<
    string,
    { stdout: string } | { errorMessage: string; stderr: string }
  >();

  function reset() {
    execFile.mockReset();
    execResults.clear();
    existsSyncPaths = new Set<string>();
    existsSync.mockReset();
    existsSync.mockImplementation((path: string) => existsSyncPaths.has(path));
    rmSync.mockReset();

    execFile.mockImplementation(
      (
        cmd: string,
        cmdArgs: string[],
        _opts: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        const key = `${cmd}::${JSON.stringify(cmdArgs)}`;
        const result = execResults.get(key);
        if (!result) {
          callback(null, "", "");
          return;
        }
        if ("stdout" in result) {
          callback(null, result.stdout, "");
        } else {
          callback(new Error(result.errorMessage), "", result.stderr);
        }
      },
    );
  }

  function addExistingPath(path: string) {
    existsSyncPaths.add(path);
  }

  function willSucceed(cmd: string, args: string[], stdout = "") {
    execResults.set(`${cmd}::${JSON.stringify(args)}`, { stdout });
  }

  function willFail(cmd: string, args: string[], stderr: string, errorMessage?: string) {
    execResults.set(`${cmd}::${JSON.stringify(args)}`, {
      errorMessage: errorMessage ?? stderr,
      stderr,
    });
  }

  return {
    get execFile() {
      return execFile;
    },
    get existsSync() {
      return existsSync;
    },
    get rmSync() {
      return rmSync;
    },
    reset,
    addExistingPath,
    willSucceed,
    willFail,
  };
});

vi.mock("node:child_process", () => ({
  execFile: mocks.execFile,
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: mocks.existsSync,
    rmSync: mocks.rmSync,
  };
});

import { GitWorktreeProvider } from "./GitWorktreeProvider";
import { WorktreeBranchExistsError, WorktreePathExistsError } from "./WorkspaceError";
import { WorkspaceProvider } from "./WorkspaceProvider";

// ── Helpers ───────────────────────────────────────────────────────────────

const repoRoot = "/home/user/my-repo";
const testSuffix = "test-suffix";
const worktreePath = "/home/user/my-repo/.forge/worktrees/task-1";
const branchName = `forge/task-1-${testSuffix}`;

function branchCheckPasses() {
  mocks.willSucceed("git", ["branch", "--list", branchName], "");
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("GitWorktreeProvider", () => {
  let provider: GitWorktreeProvider;

  beforeEach(() => {
    mocks.reset();
    provider = new GitWorktreeProvider(repoRoot, "HEAD", testSuffix);
  });

  // ── Constructor ──────────────────────────────────────────────────────

  describe("constructor", () => {
    it("defaults repoRoot to process.cwd()", () => {
      const p = new GitWorktreeProvider(undefined, "HEAD", testSuffix);
      expect(p.repoRoot).toBe(process.cwd());
    });

    it("accepts a custom repoRoot", () => {
      expect(provider.repoRoot).toBe(repoRoot);
    });

    it("defaults baseRef to HEAD", () => {
      const p = new GitWorktreeProvider(repoRoot, undefined, testSuffix);
      expect(p.baseRef).toBe("HEAD");
    });

    it("accepts a custom baseRef", () => {
      const p = new GitWorktreeProvider(repoRoot, "main", testSuffix);
      expect(p.baseRef).toBe("main");
    });

    it("defaults branchSuffix to Date.now() when not provided", () => {
      const fakeNow = 1751565000000;
      vi.spyOn(Date, "now").mockReturnValueOnce(fakeNow);
      const p = new GitWorktreeProvider(repoRoot, "HEAD");
      expect(p.repoRoot).toBe(repoRoot);
    });

    it("extends WorkspaceProvider", () => {
      expect(provider).toBeInstanceOf(WorkspaceProvider);
    });
  });

  // ── canActivate ──────────────────────────────────────────────────────

  describe("canActivate", () => {
    it("returns true when in a git worktree", async () => {
      mocks.willSucceed("git", ["rev-parse", "--is-inside-work-tree"], "true\n");

      const result = await GitWorktreeProvider.canActivate(repoRoot);
      expect(result).toBe(true);
    });

    it("returns false when not in a git repo", async () => {
      mocks.willFail("git", ["rev-parse", "--is-inside-work-tree"], "fatal: not a git repository");

      const result = await GitWorktreeProvider.canActivate(repoRoot);
      expect(result).toBe(false);
    });

    it("defaults repoRoot to process.cwd()", async () => {
      mocks.willSucceed("git", ["rev-parse", "--is-inside-work-tree"], "true\n");

      const result = await GitWorktreeProvider.canActivate();
      expect(result).toBe(true);
    });
  });

  // ── createWorkspace ──────────────────────────────────────────────────

  describe("createWorkspace", () => {
    it("creates a git worktree", async () => {
      branchCheckPasses();
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "HEAD", "-b", branchName],
        "worktree created",
      );

      const path = await provider.createWorkspace("task-1");
      expect(path).toBe(worktreePath);
    });

    it("uses custom baseRef", async () => {
      const p = new GitWorktreeProvider(repoRoot, "main", testSuffix);
      mocks.willSucceed("git", ["branch", "--list", branchName], "");
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "main", "-b", branchName],
        "worktree created",
      );

      const path = await p.createWorkspace("task-1");
      expect(path).toBe(worktreePath);
    });

    it("allows creation with dirty working tree", async () => {
      // Dirty tree does not block — git worktree creates from the commit.
      mocks.willSucceed("git", ["branch", "--list", branchName], "");
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "HEAD", "-b", branchName],
        "worktree created",
      );

      await expect(provider.createWorkspace("task-1")).resolves.toBe(worktreePath);
    });

    it("throws WorktreePathExistsError when target path already exists", async () => {
      mocks.willSucceed("git", ["branch", "--list", branchName], "");
      mocks.addExistingPath(worktreePath);

      await expect(provider.createWorkspace("task-1")).rejects.toThrow(WorktreePathExistsError);
    });

    it("throws WorktreeBranchExistsError when branch already exists", async () => {
      mocks.willSucceed("git", ["branch", "--list", branchName], `  ${branchName}`);

      await expect(provider.createWorkspace("task-1")).rejects.toThrow(WorktreeBranchExistsError);
    });

    it("proceeds when git branch --list itself fails", async () => {
      mocks.willFail("git", ["branch", "--list", branchName], "fatal: not a git repo");
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "HEAD", "-b", branchName],
        "worktree created",
      );

      const path = await provider.createWorkspace("task-1");
      expect(path).toBe(worktreePath);
    });

    it("wraps execCommand failures in WorkspaceError", async () => {
      mocks.willSucceed("git", ["branch", "--list", branchName], "");
      mocks.willFail(
        "git",
        ["worktree", "add", worktreePath, "HEAD", "-b", branchName],
        "fatal: worktree add failed",
      );

      await expect(provider.createWorkspace("task-1")).rejects.toThrow(
        "Command failed: git worktree add",
      );
    });
  });

  // ── destroyWorkspace ─────────────────────────────────────────────────

  describe("destroyWorkspace", () => {
    it("returns early when path does not exist", async () => {
      await expect(provider.destroyWorkspace(worktreePath)).resolves.toBeUndefined();
      expect(mocks.execFile).not.toHaveBeenCalled();
    });

    it("runs git worktree remove and prune on success", async () => {
      mocks.addExistingPath(worktreePath);
      mocks.willSucceed("git", ["worktree", "remove", worktreePath, "--force"], "removed");
      mocks.willSucceed("git", ["worktree", "prune"], "");

      await provider.destroyWorkspace(worktreePath);

      expect(mocks.execFile).toHaveBeenCalledWith(
        "git",
        ["worktree", "remove", worktreePath, "--force"],
        expect.any(Object),
        expect.any(Function),
      );
      expect(mocks.execFile).toHaveBeenCalledWith(
        "git",
        ["worktree", "prune"],
        expect.any(Object),
        expect.any(Function),
      );
    });

    it("falls back to rmSync when git worktree remove fails", async () => {
      mocks.addExistingPath(worktreePath);
      mocks.willFail("git", ["worktree", "remove", worktreePath, "--force"], "fatal error");
      mocks.willSucceed("git", ["worktree", "prune"], "");

      await provider.destroyWorkspace(worktreePath);

      expect(mocks.rmSync).toHaveBeenCalledWith(worktreePath, {
        recursive: true,
        force: true,
      });
    });

    it("survives rmSync failure and still prunes", async () => {
      mocks.addExistingPath(worktreePath);
      mocks.willFail("git", ["worktree", "remove", worktreePath, "--force"], "fatal error");
      mocks.rmSync.mockImplementation(() => {
        throw new Error("permission denied");
      });
      mocks.willSucceed("git", ["worktree", "prune"], "");

      await expect(provider.destroyWorkspace(worktreePath)).resolves.toBeUndefined();
      expect(mocks.execFile).toHaveBeenCalledWith(
        "git",
        ["worktree", "prune"],
        expect.any(Object),
        expect.any(Function),
      );
    });

    it("survives prune failure", async () => {
      mocks.addExistingPath(worktreePath);
      mocks.willSucceed("git", ["worktree", "remove", worktreePath, "--force"], "removed");
      mocks.willFail("git", ["worktree", "prune"], "prune failed");

      await expect(provider.destroyWorkspace(worktreePath)).resolves.toBeUndefined();
    });
  });
});
