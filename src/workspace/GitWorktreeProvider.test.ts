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

    // Single dispatch implementation — consults execResults for every call
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
          // Default: succeed with empty stdout
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

  /** Register a successful exec result for a command+args pair */
  function willSucceed(cmd: string, args: string[], stdout = "") {
    execResults.set(`${cmd}::${JSON.stringify(args)}`, { stdout });
  }

  /** Register a failing exec result for a command+args pair */
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
import {
  DirtyWorkingTreeError,
  WorktreeBranchExistsError,
  WorktreePathExistsError,
} from "./WorkspaceError";

// ── Helpers ───────────────────────────────────────────────────────────────

const repoRoot = "/home/user/my-repo";
const worktreePath = "/home/user/my-repo/.forge/worktrees/task-1";
const branchName = "forge/task-1";

/** Set up the three safety checks to all pass. */
function cleanSafetyChecks() {
  mocks.willSucceed("git", ["status", "--porcelain"], "");
  mocks.willSucceed("git", ["branch", "--list", branchName], "");
}

/** Make Worktrunk available. */
function wtAvailable() {
  mocks.willSucceed("wt", ["add", "--help"], "usage: wt add ...");
}

/** Make Worktrunk unavailable. */
function wtNotAvailable() {
  mocks.willFail("wt", ["add", "--help"], "command not found: wt");
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("GitWorktreeProvider", () => {
  let provider: GitWorktreeProvider;

  beforeEach(() => {
    mocks.reset();
    provider = new GitWorktreeProvider(repoRoot);
  });

  // ── Constructor ──────────────────────────────────────────────────────

  describe("constructor", () => {
    it("defaults repoRoot to process.cwd()", () => {
      const p = new GitWorktreeProvider();
      expect(p.repoRoot).toBe(process.cwd());
    });

    it("accepts a custom repoRoot", () => {
      expect(provider.repoRoot).toBe(repoRoot);
    });

    it("defaults baseRef to HEAD", () => {
      expect(provider.baseRef).toBe("HEAD");
    });

    it("accepts a custom baseRef", () => {
      const p = new GitWorktreeProvider(repoRoot, "main");
      expect(p.baseRef).toBe("main");
    });
  });

  // ── createWorkspace: happy path ──────────────────────────────────────

  describe("createWorkspace", () => {
    it("uses Worktrunk CLI when wt is available", async () => {
      cleanSafetyChecks();
      wtAvailable();
      mocks.willSucceed(
        "wt",
        ["add", worktreePath, "--base-ref", "HEAD", "--branch", branchName],
        "worktree created",
      );

      const path = await provider.createWorkspace("task-1");
      expect(path).toBe(worktreePath);
    });

    it("falls back to git worktree when wt is not available", async () => {
      cleanSafetyChecks();
      wtNotAvailable();
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "HEAD", "-b", branchName],
        "worktree created",
      );

      const path = await provider.createWorkspace("task-1");
      expect(path).toBe(worktreePath);
    });

    it("uses custom baseRef in the worktree command", async () => {
      const p = new GitWorktreeProvider(repoRoot, "main");
      mocks.willSucceed("git", ["status", "--porcelain"], "");
      mocks.willSucceed("git", ["branch", "--list", branchName], "");
      wtNotAvailable();
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "main", "-b", branchName],
        "worktree created",
      );

      const path = await p.createWorkspace("task-1");
      expect(path).toBe(worktreePath);
    });
  });

  // ── createWorkspace: safety checks ───────────────────────────────────

  describe("createWorkspace safety checks", () => {
    it("throws DirtyWorkingTreeError when repo has uncommitted changes", async () => {
      mocks.willSucceed("git", ["status", "--porcelain"], "M src/file.ts");

      await expect(provider.createWorkspace("task-1")).rejects.toThrow(DirtyWorkingTreeError);
    });

    it("throws WorktreePathExistsError when target path already exists", async () => {
      mocks.willSucceed("git", ["status", "--porcelain"], "");
      mocks.addExistingPath(worktreePath);

      await expect(provider.createWorkspace("task-1")).rejects.toThrow(WorktreePathExistsError);
    });

    it("throws WorktreeBranchExistsError when branch already exists", async () => {
      mocks.willSucceed("git", ["status", "--porcelain"], "");
      mocks.willSucceed("git", ["branch", "--list", branchName], "  forge/task-1");

      await expect(provider.createWorkspace("task-1")).rejects.toThrow(WorktreeBranchExistsError);
    });

    it("proceeds when git branch --list itself fails", async () => {
      mocks.willSucceed("git", ["status", "--porcelain"], "");
      mocks.willFail("git", ["branch", "--list", branchName], "fatal: not a git repo");
      wtNotAvailable();
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "HEAD", "-b", branchName],
        "worktree created",
      );

      const path = await provider.createWorkspace("task-1");
      expect(path).toBe(worktreePath);
    });

    it("wraps execCommand failures in WorkspaceError", async () => {
      cleanSafetyChecks();
      wtNotAvailable();
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
      // existsSync returns false by default
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
