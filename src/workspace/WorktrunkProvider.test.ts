import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock setup ───────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const execFile = vi.fn();
  let existsSyncPaths = new Set<string>();
  const existsSync = vi.fn((path: string) => existsSyncPaths.has(path));
  const rmSync = vi.fn();
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

import { WorktreeBranchExistsError } from "./WorkspaceError";
import { WorkspaceProvider } from "./WorkspaceProvider";
import { WorktrunkProvider } from "./WorktrunkProvider";

// ── Helpers ───────────────────────────────────────────────────────────────

const repoRoot = "/home/user/my-repo";
const branchName = "forge/task-1";

function branchCheckPasses() {
  mocks.willSucceed("git", ["branch", "--list", branchName], "");
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("WorktrunkProvider", () => {
  let provider: WorktrunkProvider;

  beforeEach(() => {
    mocks.reset();
    provider = new WorktrunkProvider(repoRoot);
  });

  // ── Constructor ──────────────────────────────────────────────────────

  describe("constructor", () => {
    it("defaults repoRoot to process.cwd()", () => {
      const p = new WorktrunkProvider();
      expect(p.repoRoot).toBe(process.cwd());
    });

    it("accepts a custom repoRoot", () => {
      expect(provider.repoRoot).toBe(repoRoot);
    });

    it("defaults baseRef to HEAD", () => {
      expect(provider.baseRef).toBe("HEAD");
    });

    it("accepts a custom baseRef", () => {
      const p = new WorktrunkProvider(repoRoot, "main");
      expect(p.baseRef).toBe("main");
    });

    it("extends WorkspaceProvider", () => {
      expect(provider).toBeInstanceOf(WorkspaceProvider);
    });
  });

  // ── canActivate ──────────────────────────────────────────────────────

  describe("canActivate", () => {
    it("returns true when wt add --help succeeds", async () => {
      mocks.willSucceed("wt", ["add", "--help"], "usage: wt add ...");

      const result = await WorktrunkProvider.canActivate(repoRoot);
      expect(result).toBe(true);
    });

    it("returns false when wt is not available", async () => {
      mocks.willFail("wt", ["add", "--help"], "command not found: wt");

      const result = await WorktrunkProvider.canActivate(repoRoot);
      expect(result).toBe(false);
    });

    it("defaults repoRoot to process.cwd()", async () => {
      mocks.willSucceed("wt", ["add", "--help"], "usage: wt add ...");

      const result = await WorktrunkProvider.canActivate();
      expect(result).toBe(true);
    });
  });

  // ── createWorkspace ──────────────────────────────────────────────────

  describe("createWorkspace", () => {
    it("runs wt add and parses returned path from stdout", async () => {
      branchCheckPasses();
      const wtResultPath = "/tmp/wt-worktrees/task-1";
      mocks.willSucceed(
        "wt",
        ["add", "--base-ref", "HEAD", "--branch", branchName],
        `Created worktree\n${wtResultPath}`,
      );

      const path = await provider.createWorkspace("task-1");
      expect(path).toBe(wtResultPath);
    });

    it("passes custom baseRef to wt add", async () => {
      const p = new WorktrunkProvider(repoRoot, "main");
      mocks.willSucceed("git", ["branch", "--list", "forge/task-2"], "");
      const wtResultPath = "/tmp/wt-worktrees/task-2";
      mocks.willSucceed(
        "wt",
        ["add", "--base-ref", "main", "--branch", "forge/task-2"],
        wtResultPath,
      );

      const path = await p.createWorkspace("task-2");
      expect(path).toBe(wtResultPath);
    });

    it("throws when wt returns empty output", async () => {
      mocks.willSucceed("git", ["branch", "--list", branchName], "");
      mocks.willSucceed("wt", ["add", "--base-ref", "HEAD", "--branch", branchName], "");

      await expect(provider.createWorkspace("task-1")).rejects.toThrow(
        "Worktrunk returned no path in output",
      );
    });

    it("parses last line from wt output as path", async () => {
      branchCheckPasses();
      const wtResultPath = "/home/user/projects/.forge/wt-12345";
      mocks.willSucceed(
        "wt",
        ["add", "--base-ref", "HEAD", "--branch", branchName],
        `Setup branch forge/task-1\n${wtResultPath}`,
      );

      const path = await provider.createWorkspace("task-1");
      expect(path).toBe(wtResultPath);
    });

    it("throws WorktreeBranchExistsError when branch already exists", async () => {
      mocks.willSucceed("git", ["branch", "--list", branchName], "  forge/task-1");

      await expect(provider.createWorkspace("task-1")).rejects.toThrow(WorktreeBranchExistsError);
    });

    it("wraps execCommand failures in WorkspaceError", async () => {
      mocks.willSucceed("git", ["branch", "--list", branchName], "");
      mocks.willFail(
        "wt",
        ["add", "--base-ref", "HEAD", "--branch", branchName],
        "fatal: wt add failed",
      );

      await expect(provider.createWorkspace("task-1")).rejects.toThrow("Command failed: wt add");
    });
  });

  // ── destroyWorkspace ─────────────────────────────────────────────────

  describe("destroyWorkspace", () => {
    const wtPath = "/tmp/wt-worktrees/task-1";

    it("returns early when path does not exist", async () => {
      await expect(provider.destroyWorkspace(wtPath)).resolves.toBeUndefined();
      expect(mocks.execFile).not.toHaveBeenCalled();
    });

    it("runs git worktree remove and prune on success", async () => {
      mocks.addExistingPath(wtPath);
      mocks.willSucceed("git", ["worktree", "remove", wtPath, "--force"], "removed");
      mocks.willSucceed("git", ["worktree", "prune"], "");

      await provider.destroyWorkspace(wtPath);
      expect(mocks.execFile).toHaveBeenCalledWith(
        "git",
        ["worktree", "remove", wtPath, "--force"],
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
      mocks.addExistingPath(wtPath);
      mocks.willFail("git", ["worktree", "remove", wtPath, "--force"], "fatal error");
      mocks.willSucceed("git", ["worktree", "prune"], "");

      await provider.destroyWorkspace(wtPath);
      expect(mocks.rmSync).toHaveBeenCalledWith(wtPath, { recursive: true, force: true });
    });
  });
});
