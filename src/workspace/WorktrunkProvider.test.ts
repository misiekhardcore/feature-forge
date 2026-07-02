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

import { WorkspaceError, WorktreeBranchExistsError } from "./WorkspaceError";
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

    it("defaults baseRef to '@' (the current branch / HEAD)", () => {
      const p = new WorktrunkProvider();
      expect(p.baseRef).toBe("@");
    });

    it("accepts a custom baseRef", () => {
      const p = new WorktrunkProvider(repoRoot, "develop");
      expect(p.baseRef).toBe("develop");
    });

    it("extends WorkspaceProvider", () => {
      expect(provider).toBeInstanceOf(WorkspaceProvider);
    });
  });

  // ── canActivate ──────────────────────────────────────────────────────

  describe("canActivate", () => {
    it("returns true when wt switch --help succeeds", async () => {
      mocks.willSucceed("wt", ["switch", "--help"], "usage: wt switch ...");

      const result = await WorktrunkProvider.canActivate(repoRoot);
      expect(result).toBe(true);
    });

    it("returns false when wt is not available", async () => {
      mocks.willFail("wt", ["switch", "--help"], "command not found: wt");

      const result = await WorktrunkProvider.canActivate(repoRoot);
      expect(result).toBe(false);
    });

    it("defaults repoRoot to process.cwd()", async () => {
      mocks.willSucceed("wt", ["switch", "--help"], "usage: wt switch ...");

      const result = await WorktrunkProvider.canActivate();
      expect(result).toBe(true);
    });
  });

  // ── createWorkspace ──────────────────────────────────────────────────

  describe("createWorkspace", () => {
    const fullWtArgs = ["switch", "-c", branchName, "--base", "@"];

    it("runs wt switch -c with --base @ by default and parses path after @", async () => {
      branchCheckPasses();
      const wtResultPath = "/tmp/wt-worktrees/task-1";
      mocks.addExistingPath(wtResultPath);
      mocks.willSucceed(
        "wt",
        fullWtArgs,
        `✓ Created branch ${branchName} from main and worktree @ ${wtResultPath}`,
      );

      const path = await provider.createWorkspace("task-1");
      expect(path).toBe(wtResultPath);
      expect(mocks.execFile).toHaveBeenCalledWith(
        "wt",
        fullWtArgs,
        expect.any(Object),
        expect.any(Function),
      );
    });

    it("derives branch name from workspace id", async () => {
      mocks.willSucceed("git", ["branch", "--list", "forge/task-2"], "");
      const wtResultPath = "/tmp/wt-worktrees/task-2";
      mocks.addExistingPath(wtResultPath);
      mocks.willSucceed(
        "wt",
        ["switch", "-c", "forge/task-2", "--base", "@"],
        `✓ Created branch forge/task-2 from main and worktree @ ${wtResultPath}`,
      );

      const path = await provider.createWorkspace("task-2");
      expect(path).toBe(wtResultPath);
    });

    it("passes a custom baseRef to wt switch -c via --base", async () => {
      const customProvider = new WorktrunkProvider(repoRoot, "develop");
      mocks.willSucceed("git", ["branch", "--list", branchName], "");
      const wtResultPath = "/tmp/wt-worktrees/task-1";
      mocks.addExistingPath(wtResultPath);
      mocks.willSucceed(
        "wt",
        ["switch", "-c", branchName, "--base", "develop"],
        `✓ Created branch ${branchName} from develop and worktree @ ${wtResultPath}`,
      );

      const path = await customProvider.createWorkspace("task-1");
      expect(path).toBe(wtResultPath);
      expect(mocks.execFile).toHaveBeenCalledWith(
        "wt",
        ["switch", "-c", branchName, "--base", "develop"],
        expect.any(Object),
        expect.any(Function),
      );
    });

    it("throws when wt returns empty output", async () => {
      mocks.willSucceed("git", ["branch", "--list", branchName], "");
      mocks.willSucceed("wt", fullWtArgs, "");

      await expect(provider.createWorkspace("task-1")).rejects.toThrow(
        "Command produced no output",
      );
    });

    it("throws WorkspaceError when output has no 'worktree @' line", async () => {
      mocks.willSucceed("git", ["branch", "--list", branchName], "");
      mocks.willSucceed("wt", fullWtArgs, "Some message ending with @ but no worktree marker");

      await expect(provider.createWorkspace("task-1")).rejects.toThrow(WorkspaceError);
      await expect(provider.createWorkspace("task-1")).rejects.toThrow(
        "did not contain a 'worktree @ <path>' line",
      );
    });

    it("parses path after @ from multiline wt output", async () => {
      branchCheckPasses();
      const wtResultPath = "/home/user/projects/.forge/wt-12345";
      mocks.addExistingPath(wtResultPath);
      mocks.willSucceed(
        "wt",
        fullWtArgs,
        `Setting up branch ${branchName}\n✓ Created branch ${branchName} from main and worktree @ ${wtResultPath}`,
      );

      const path = await provider.createWorkspace("task-1");
      expect(path).toBe(wtResultPath);
    });

    it("expands tilde in wt path to home directory", async () => {
      branchCheckPasses();
      const { homedir } = await import("node:os");
      const expandedPath = `${homedir()}/Projects/feature-forge.task-1`;
      mocks.addExistingPath(expandedPath);
      mocks.willSucceed(
        "wt",
        fullWtArgs,
        `✓ Created branch ${branchName} from main and worktree @ ~/Projects/feature-forge.task-1`,
      );

      const path = await provider.createWorkspace("task-1");
      expect(path).toBe(expandedPath);
    });

    it("throws WorkspaceError when the whole last line lacks the worktree marker", async () => {
      branchCheckPasses();
      const fallbackPath = "/some/provider/output/path";
      mocks.willSucceed("wt", fullWtArgs, fallbackPath);

      await expect(provider.createWorkspace("task-1")).rejects.toThrow(WorkspaceError);
      await expect(provider.createWorkspace("task-1")).rejects.toThrow(
        "did not contain a 'worktree @ <path>' line",
      );
    });

    it("throws WorkspaceError when the parsed worktree path does not exist on disk", async () => {
      branchCheckPasses();
      const missingPath = "/nonexistent/wt-worktree/task-1";
      // NOTE: deliberately NOT calling mocks.addExistingPath(missingPath).
      mocks.willSucceed(
        "wt",
        fullWtArgs,
        `✓ Created branch ${branchName} from main and worktree @ ${missingPath}`,
      );

      await expect(provider.createWorkspace("task-1")).rejects.toThrow(WorkspaceError);
      await expect(provider.createWorkspace("task-1")).rejects.toThrow("does not exist on disk");
    });

    it("throws WorktreeBranchExistsError when branch already exists", async () => {
      mocks.willSucceed("git", ["branch", "--list", branchName], "  forge/task-1");

      await expect(provider.createWorkspace("task-1")).rejects.toThrow(WorktreeBranchExistsError);
    });

    it("wraps execCommand failures in WorkspaceError", async () => {
      mocks.willSucceed("git", ["branch", "--list", branchName], "");
      mocks.willFail("wt", fullWtArgs, "fatal: wt switch failed");

      await expect(provider.createWorkspace("task-1")).rejects.toThrow("Command failed: wt");
    });
  });

  // ── destroyWorkspace ─────────────────────────────────────────────────

  describe("destroyWorkspace", () => {
    const wtPath = "/tmp/wt-worktrees/task-1";

    it("returns early when path does not exist", async () => {
      await expect(provider.destroyWorkspace(wtPath)).resolves.toBeUndefined();
      expect(mocks.execFile).not.toHaveBeenCalled();
    });

    it("runs wt remove with --force --yes --foreground", async () => {
      mocks.addExistingPath(wtPath);
      mocks.willSucceed("wt", ["remove", wtPath, "--force", "--yes", "--foreground"], "removed");

      await provider.destroyWorkspace(wtPath);
      expect(mocks.execFile).toHaveBeenCalledWith(
        "wt",
        ["remove", wtPath, "--force", "--yes", "--foreground"],
        expect.any(Object),
        expect.any(Function),
      );
    });

    it("falls back to git worktree remove when wt remove fails", async () => {
      mocks.addExistingPath(wtPath);
      mocks.willFail(
        "wt",
        ["remove", wtPath, "--force", "--yes", "--foreground"],
        "wt remove failed",
      );
      mocks.willSucceed("git", ["worktree", "remove", wtPath, "--force"], "removed");
      mocks.willSucceed("git", ["worktree", "prune"], "");

      await provider.destroyWorkspace(wtPath);
      expect(mocks.execFile).toHaveBeenCalledWith(
        "git",
        ["worktree", "remove", wtPath, "--force"],
        expect.any(Object),
        expect.any(Function),
      );
    });

    it("falls back to rmSync when both wt and git fail", async () => {
      mocks.addExistingPath(wtPath);
      mocks.willFail(
        "wt",
        ["remove", wtPath, "--force", "--yes", "--foreground"],
        "wt remove failed",
      );
      mocks.willFail("git", ["worktree", "remove", wtPath, "--force"], "fatal error");
      mocks.willSucceed("git", ["worktree", "prune"], "");

      await provider.destroyWorkspace(wtPath);
      expect(mocks.rmSync).toHaveBeenCalledWith(wtPath, { recursive: true, force: true });
    });
  });
});
