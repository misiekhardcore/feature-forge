import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock setup ───────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const execFile = vi.fn();
  let existsSyncPaths = new Set<string>();
  const existsSync = vi.fn((path: string) => existsSyncPaths.has(path.replace(/\/$/, "")));
  const rmSync = vi.fn();
  const symlinkSync = vi.fn();
  const mkdirSync = vi.fn();
  const lstatSync = vi.fn();
  const readlinkSync = vi.fn();
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
    existsSync.mockImplementation((path: string) => existsSyncPaths.has(path.replace(/\/$/, "")));
    rmSync.mockReset();
    symlinkSync.mockReset();
    mkdirSync.mockReset();
    lstatSync.mockReset();
    readlinkSync.mockReset();

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
    existsSyncPaths.add(path.replace(/\/$/, ""));
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
    get symlinkSync() {
      return symlinkSync;
    },
    get mkdirSync() {
      return mkdirSync;
    },
    get lstatSync() {
      return lstatSync;
    },
    get readlinkSync() {
      return readlinkSync;
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
    symlinkSync: mocks.symlinkSync,
    mkdirSync: mocks.mkdirSync,
    lstatSync: mocks.lstatSync,
    readlinkSync: mocks.readlinkSync,
  };
});

import { logger } from "../logging";
import { GitWorktreeProvider } from "./GitWorktreeProvider";
import { WorktreeBranchExistsError, WorktreePathExistsError } from "./WorkspaceError";
import { WorkspaceProvider } from "./WorkspaceProvider";

// ── Helpers ───────────────────────────────────────────────────────────────

const repoRoot = "/home/user/my-repo";
const worktreePath = `/home/user/my-repo/.forge/worktrees/task-1`;
const branchName = `forge/task-1`;

function branchCheckPasses() {
  mocks.willSucceed("git", ["branch", "--list", branchName], "");
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("GitWorktreeProvider", () => {
  let provider: GitWorktreeProvider;

  beforeEach(() => {
    mocks.reset();
    provider = new GitWorktreeProvider(repoRoot);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Constructor ──────────────────────────────────────────────────────

  describe("constructor", () => {
    it("defaults repoRoot to process.cwd()", () => {
      const p = new GitWorktreeProvider(undefined);
      expect(p.repoRoot).toBe(process.cwd());
    });

    it("accepts a custom repoRoot", () => {
      expect(provider.repoRoot).toBe(repoRoot);
    });

    it("defaults baseRef to origin/HEAD", () => {
      const p = new GitWorktreeProvider(repoRoot);
      expect(p.baseRef).toBe("origin/HEAD");
    });

    it("accepts a custom baseRef", () => {
      const p = new GitWorktreeProvider(repoRoot, "main");
      expect(p.baseRef).toBe("main");
    });

    it("extends WorkspaceProvider", () => {
      expect(provider).toBeInstanceOf(WorkspaceProvider);
    });
  });

  // ── signal propagation ───────────────────────────────────────────────

  describe("signal", () => {
    it("passes signal to execFile options", async () => {
      const controller = new AbortController();
      mocks.willSucceed("git", ["rev-parse", "--is-inside-work-tree"], "true\n");

      // execCommandStatic is private static; access via type assertion for testing
      const Provider = GitWorktreeProvider as unknown as {
        execCommandStatic: (
          cwd: string,
          command: string,
          args: string[],
          signal?: AbortSignal,
        ) => Promise<string>;
      };

      await Provider.execCommandStatic(repoRoot, "git", ["rev-parse"], controller.signal);

      const callOpts = mocks.execFile.mock.calls[0][2];
      expect(callOpts.signal).toBe(controller.signal);
    });

    it("aborts when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const Provider = GitWorktreeProvider as unknown as {
        execCommandStatic: (
          cwd: string,
          command: string,
          args: string[],
          signal?: AbortSignal,
        ) => Promise<string>;
      };

      // When signal is already aborted, execFile should reject.
      // Our mock calls back synchronously with success, so simulate the abort:
      mocks.execFile.mockImplementationOnce(
        (
          _cmd: string,
          _cmdArgs: string[],
          _opts: unknown,
          callback: (error: Error | null, stdout: string, stderr: string) => void,
        ) => {
          callback(new DOMException("The operation was aborted", "AbortError"), "", "");
        },
      );

      await expect(
        Provider.execCommandStatic(repoRoot, "git", ["rev-parse"], controller.signal),
      ).rejects.toThrow("The operation was aborted");
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
        ["worktree", "add", worktreePath, "origin/HEAD", "-b", branchName],
        "worktree created",
      );

      const path = await provider.createWorkspace("task-1");
      expect(path).toBe(worktreePath);
    });

    it("uses custom baseRef", async () => {
      const p = new GitWorktreeProvider(repoRoot, "main");
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
        ["worktree", "add", worktreePath, "origin/HEAD", "-b", branchName],
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
        ["worktree", "add", worktreePath, "origin/HEAD", "-b", branchName],
        "worktree created",
      );

      const path = await provider.createWorkspace("task-1");
      expect(path).toBe(worktreePath);
    });

    it("wraps execCommand failures in WorkspaceError", async () => {
      mocks.willSucceed("git", ["branch", "--list", branchName], "");
      mocks.willFail(
        "git",
        ["worktree", "add", worktreePath, "origin/HEAD", "-b", branchName],
        "fatal: worktree add failed",
      );

      await expect(provider.createWorkspace("task-1")).rejects.toThrow(
        "Command failed: git worktree add",
      );
    });

    it("refreshes remote refs before creating a worktree", async () => {
      branchCheckPasses();
      mocks.willSucceed("git", ["remote"], "origin\n");
      mocks.willSucceed("git", ["fetch", "origin"], "");
      mocks.willSucceed("git", ["rev-parse", "--verify", "origin/HEAD^{commit}"], "abc123\n");
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "origin/HEAD", "-b", branchName],
        "worktree created",
      );

      await provider.createWorkspace("task-1");

      const calls = mocks.execFile.mock.calls.map(
        (call: unknown[]) => `${String(call[0])}::${JSON.stringify(call[1])}`,
      );
      const fetchIndex = calls.indexOf(`git::${JSON.stringify(["fetch", "origin"])}`);
      const verifyIndex = calls.indexOf(
        `git::${JSON.stringify(["rev-parse", "--verify", "origin/HEAD^{commit}"])}`,
      );
      const addIndex = calls.indexOf(
        `git::${JSON.stringify(["worktree", "add", worktreePath, "origin/HEAD", "-b", branchName])}`,
      );
      expect(fetchIndex).toBeGreaterThanOrEqual(0);
      expect(verifyIndex).toBeGreaterThan(fetchIndex);
      expect(addIndex).toBeGreaterThan(verifyIndex);
    });

    it("proceeds when remote ref refresh fails", async () => {
      // A failed fetch is non-fatal when origin/HEAD already resolves locally
      // (e.g. a clone whose remote is temporarily unreachable).
      branchCheckPasses();
      mocks.willSucceed("git", ["remote"], "origin\n");
      mocks.willFail(
        "git",
        ["fetch", "origin"],
        "fatal: unable to access 'https://github.com/forge/test-repo/': Could not resolve host",
      );
      mocks.willSucceed("git", ["rev-parse", "--verify", "origin/HEAD^{commit}"], "abc123\n");
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "origin/HEAD", "-b", branchName],
        "worktree created",
      );

      await expect(provider.createWorkspace("task-1")).resolves.toBe(worktreePath);

      // The worktree was created from the still-resolvable origin/HEAD (the
      // possibly-stale ref), NOT the local HEAD fallback
      const calls = mocks.execFile.mock.calls.map(
        (call: unknown[]) => `${String(call[0])}::${JSON.stringify(call[1])}`,
      );
      expect(calls).toContain(
        `git::${JSON.stringify(["worktree", "add", worktreePath, "origin/HEAD", "-b", branchName])}`,
      );
      expect(calls).not.toContain(
        `git::${JSON.stringify(["worktree", "add", worktreePath, "HEAD", "-b", branchName])}`,
      );
    });

    it("falls back to local HEAD when origin/HEAD cannot be resolved", async () => {
      // Origin is configured but the fetch fails, and origin/HEAD does not
      // resolve: creation must fall back to the local HEAD instead of
      // hard-failing on `git worktree add ... origin/HEAD`.
      branchCheckPasses();
      mocks.willSucceed("git", ["remote"], "origin\n");
      mocks.willFail(
        "git",
        ["fetch", "origin"],
        "fatal: 'origin' does not appear to be a git repository",
      );
      mocks.willFail(
        "git",
        ["rev-parse", "--verify", "origin/HEAD^{commit}"],
        "fatal: Needed a single revision",
      );
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "HEAD", "-b", branchName],
        "worktree created",
      );

      const path = await provider.createWorkspace("task-1");
      expect(path).toBe(worktreePath);

      // The worktree was created from the fallback ref, not origin/HEAD
      const calls = mocks.execFile.mock.calls.map(
        (call: unknown[]) => `${String(call[0])}::${JSON.stringify(call[1])}`,
      );
      expect(calls).not.toContain(
        `git::${JSON.stringify(["worktree", "add", worktreePath, "origin/HEAD", "-b", branchName])}`,
      );
    });

    it("falls back to local HEAD when fetch succeeds but origin/HEAD does not resolve", async () => {
      // Repos whose origin was added via `git remote add` after `git init` on
      // git < 2.48, and clones taken from an empty remote (version-independent):
      // the fetch succeeds but origin/HEAD still does not resolve, so the base
      // must fall back to the local HEAD without hard-failing.
      const warnSpy = vi.spyOn(logger, "warn");
      branchCheckPasses();
      mocks.willSucceed("git", ["remote"], "origin\n");
      mocks.willSucceed("git", ["fetch", "origin"], "");
      mocks.willFail(
        "git",
        ["rev-parse", "--verify", "origin/HEAD^{commit}"],
        "fatal: Needed a single revision",
      );
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "HEAD", "-b", branchName],
        "worktree created",
      );

      const path = await provider.createWorkspace("task-1");
      expect(path).toBe(worktreePath);

      // The worktree was created from the fallback ref, not origin/HEAD
      const calls = mocks.execFile.mock.calls.map(
        (call: unknown[]) => `${String(call[0])}::${JSON.stringify(call[1])}`,
      );
      expect(calls).toContain(
        `git::${JSON.stringify(["worktree", "add", worktreePath, "HEAD", "-b", branchName])}`,
      );
      expect(calls).not.toContain(
        `git::${JSON.stringify(["worktree", "add", worktreePath, "origin/HEAD", "-b", branchName])}`,
      );
      expect(warnSpy).toHaveBeenCalledWith(
        "Base ref does not resolve; falling back to local HEAD",
        {
          baseRef: "origin/HEAD",
        },
      );
    });

    it("skips origin fetch when no origin remote is configured", async () => {
      // Local-only repo: `git remote` lists no origin, so the best-effort
      // fetch is skipped entirely - no pointless failing subprocess and no
      // "Remote ref refresh failed" warning. The base still falls back to the
      // local HEAD, and that fallback warning fires deliberately - the
      // fallback is a real state change worth signaling.
      const warnSpy = vi.spyOn(logger, "warn");
      branchCheckPasses();
      mocks.willSucceed("git", ["remote"], "");
      mocks.willFail(
        "git",
        ["rev-parse", "--verify", "origin/HEAD^{commit}"],
        "fatal: Needed a single revision",
      );
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "HEAD", "-b", branchName],
        "worktree created",
      );

      const path = await provider.createWorkspace("task-1");
      expect(path).toBe(worktreePath);

      // No fetch was attempted and the worktree used the HEAD fallback
      const calls = mocks.execFile.mock.calls.map(
        (call: unknown[]) => `${String(call[0])}::${JSON.stringify(call[1])}`,
      );
      expect(calls).not.toContain(`git::${JSON.stringify(["fetch", "origin"])}`);
      expect(calls).toContain(
        `git::${JSON.stringify(["worktree", "add", worktreePath, "HEAD", "-b", branchName])}`,
      );
      expect(calls).not.toContain(
        `git::${JSON.stringify(["worktree", "add", worktreePath, "origin/HEAD", "-b", branchName])}`,
      );

      // The fetch-skip path emits no "Remote ref refresh failed" warning, but
      // the fallback warning fires on purpose: creation silently switched the
      // base ref to the local HEAD, which is a real state change.
      expect(warnSpy).toHaveBeenCalledWith(
        "Base ref does not resolve; falling back to local HEAD",
        { baseRef: "origin/HEAD" },
      );
      expect(warnSpy).not.toHaveBeenCalledWith(
        "Remote ref refresh failed; continuing with existing refs",
        expect.anything(),
      );
    });

    it("explicit origin/HEAD baseRef option is equivalent to the default (fetch + fallback)", async () => {
      // Passing baseRef: "origin/HEAD" via options behaves like the default:
      // the ref is still refreshed best-effort and verified, unlike other
      // explicit refs which are used as-is with no fetch.
      branchCheckPasses();
      mocks.willSucceed("git", ["remote"], "origin\n");
      mocks.willSucceed("git", ["fetch", "origin"], "");
      mocks.willSucceed("git", ["rev-parse", "--verify", "origin/HEAD^{commit}"], "abc123\n");
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "origin/HEAD", "-b", branchName],
        "worktree created",
      );

      const path = await provider.createWorkspace("task-1", { baseRef: "origin/HEAD" });
      expect(path).toBe(worktreePath);

      // The explicit origin/HEAD was still refreshed before use
      const calls = mocks.execFile.mock.calls.map(
        (call: unknown[]) => `${String(call[0])}::${JSON.stringify(call[1])}`,
      );
      expect(calls).toContain(`git::${JSON.stringify(["fetch", "origin"])}`);
      expect(calls).toContain(
        `git::${JSON.stringify(["rev-parse", "--verify", "origin/HEAD^{commit}"])}`,
      );
      expect(calls).toContain(
        `git::${JSON.stringify(["worktree", "add", worktreePath, "origin/HEAD", "-b", branchName])}`,
      );
    });

    it("does not fetch or fall back when baseRef is provided via options", async () => {
      // Explicit immutable baseRef (e.g. create_workspace(baseRef=<sha>)):
      // no best-effort fetch and no fallback - the ref is used as-is.
      mocks.willSucceed("git", ["branch", "--list", branchName], "");
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "abc123", "-b", branchName],
        "worktree created",
      );

      const path = await provider.createWorkspace("task-1", { baseRef: "abc123" });
      expect(path).toBe(worktreePath);

      const calls = mocks.execFile.mock.calls.map(
        (call: unknown[]) => `${String(call[0])}::${JSON.stringify(call[1])}`,
      );
      expect(calls).not.toContain(`git::${JSON.stringify(["fetch", "origin"])}`);
      expect(calls).not.toContain(
        `git::${JSON.stringify(["rev-parse", "--verify", "origin/HEAD^{commit}"])}`,
      );
    });

    it("does not fetch or fall back for a custom constructor baseRef", async () => {
      const p = new GitWorktreeProvider(repoRoot, "main");
      mocks.willSucceed("git", ["branch", "--list", branchName], "");
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "main", "-b", branchName],
        "worktree created",
      );

      const path = await p.createWorkspace("task-1");
      expect(path).toBe(worktreePath);

      const calls = mocks.execFile.mock.calls.map(
        (call: unknown[]) => `${String(call[0])}::${JSON.stringify(call[1])}`,
      );
      expect(calls).not.toContain(`git::${JSON.stringify(["fetch", "origin"])}`);
    });

    it("fails when an explicit baseRef does not resolve", async () => {
      // Explicit refs are trusted as-is: an unresolvable explicit ref is a
      // loud failure, never a silent fallback to HEAD.
      const p = new GitWorktreeProvider(repoRoot, "main");
      mocks.willSucceed("git", ["branch", "--list", branchName], "");
      mocks.willFail(
        "git",
        ["worktree", "add", worktreePath, "main", "-b", branchName],
        "fatal: invalid reference: main",
      );

      await expect(p.createWorkspace("task-1")).rejects.toThrow("Command failed: git worktree add");
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

    describe("branch deletion", () => {
      it("deletes the branch after worktree removal", async () => {
        mocks.addExistingPath(worktreePath);
        mocks.willSucceed("git", ["worktree", "remove", worktreePath, "--force"], "removed");
        mocks.willSucceed("git", ["worktree", "prune"], "");
        mocks.willSucceed("git", ["branch", "-D", branchName], "Deleted branch forge/task-1.");

        await provider.destroyWorkspace(worktreePath, branchName);

        expect(mocks.execFile).toHaveBeenCalledWith(
          "git",
          ["branch", "-D", branchName],
          expect.any(Object),
          expect.any(Function),
        );
      });

      it("logs warning and continues when branch deletion fails", async () => {
        mocks.addExistingPath(worktreePath);
        mocks.willSucceed("git", ["worktree", "remove", worktreePath, "--force"], "removed");
        mocks.willSucceed("git", ["worktree", "prune"], "");
        mocks.willFail("git", ["branch", "-D", branchName], "branch not found");

        await expect(provider.destroyWorkspace(worktreePath, branchName)).resolves.toBeUndefined();
      });

      it("skips branch deletion when branch is not provided", async () => {
        mocks.addExistingPath(worktreePath);
        mocks.willSucceed("git", ["worktree", "remove", worktreePath, "--force"], "removed");
        mocks.willSucceed("git", ["worktree", "prune"], "");

        await provider.destroyWorkspace(worktreePath);

        // branch -D should not have been called
        const allCalls = mocks.execFile.mock.calls.map(
          (call: unknown[]) => `${String(call[0])}::${JSON.stringify(call[1])}`,
        );
        expect(allCalls).not.toContain(`git::${JSON.stringify(["branch", "-D", branchName])}`);
      });

      it("returns early without branch deletion when path does not exist", async () => {
        // path does not exist (not added to existsSync)
        await provider.destroyWorkspace(worktreePath, branchName);

        // No git commands should be called at all
        expect(mocks.execFile).not.toHaveBeenCalled();
      });
    });
  });

  // ── Symbolic links ──────────────────────────────────────────────────

  describe("createWorkspace symlinks", () => {
    beforeEach(() => {
      // Add platform symlink sources as existing paths
      mocks.addExistingPath(`${repoRoot}/.pi/`);
      mocks.addExistingPath(`${repoRoot}/.forge/logs/`);
      mocks.addExistingPath(`${repoRoot}/.forge/worktrees.json`);
      mocks.addExistingPath(`${repoRoot}/.env`);
      // lstatSync on the source determines symlink type (dir vs file)
      mocks.lstatSync.mockImplementation(() => ({
        isDirectory: () => true,
        isSymbolicLink: () => false,
      }));
      // The worktree's local git exclude file is resolved via git; from the
      // main checkout git returns the path relative to its cwd
      mocks.willSucceed("git", ["rev-parse", "--git-path", "info/exclude"], ".git/info/exclude");
    });

    it("creates platform symlinks after worktree creation", async () => {
      branchCheckPasses();
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "origin/HEAD", "-b", branchName],
        "worktree created",
      );

      await provider.createWorkspace("task-1");

      // Platform symlinks should have been created
      expect(mocks.symlinkSync).toHaveBeenCalledTimes(4);

      // .pi lives at the root of the worktree, so parent dir exists
      expect(mocks.symlinkSync).toHaveBeenCalledWith(
        expect.stringContaining(".."),
        `${worktreePath}/.pi`,
        "dir",
      );
    });

    it("merges all three sources with dedup", async () => {
      mocks.addExistingPath(`${repoRoot}/.pi/`);

      branchCheckPasses();
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "origin/HEAD", "-b", branchName],
        "worktree created",
      );

      await provider.createWorkspace("task-1", { symlinks: [".pi/", ".forge/logs"] });

      // Dedup: .pi appears in all three sources but should only be created once
      // .forge/logs appears in platform and stepSymlinks — once
      // .forge/worktrees.json only in platform — once
      // .env only in platform — once
      expect(mocks.symlinkSync).toHaveBeenCalledTimes(4);
    });

    it("uses relative symlink paths", async () => {
      mocks.addExistingPath(`${repoRoot}/.pi/`);

      branchCheckPasses();
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "origin/HEAD", "-b", branchName],
        "worktree created",
      );

      await provider.createWorkspace("task-1");

      // The symlink target should have a relative path to the source
      const symlinkCall = mocks.symlinkSync.mock.calls.find((call: unknown[]) =>
        (call[1] as string).endsWith(".pi"),
      );
      expect(symlinkCall).toBeDefined();
      expect(symlinkCall![0]).not.toContain(repoRoot);
    });

    it("skips missing sources with warning", async () => {
      // nonexistent-dir is passed as a step-level symlink but has no source in
      // the repo, so it must be skipped instead of creating a dangling link.
      // The 4 platform symlinks are still created.

      branchCheckPasses();
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "origin/HEAD", "-b", branchName],
        "worktree created",
      );

      await provider.createWorkspace("task-1", { symlinks: ["nonexistent-dir"] });

      // 4 platform symlinks (nonexistent-dir is skipped)
      expect(mocks.symlinkSync).toHaveBeenCalledTimes(4);

      // Verify the nonexistent env symlink was NOT created
      const symlinkTargets = mocks.symlinkSync.mock.calls.map((call: unknown[]) => call[1]);
      expect(symlinkTargets).not.toContain(`${worktreePath}/nonexistent-dir`);
    });

    it("creates parent directories for nested symlink targets", async () => {
      branchCheckPasses();
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "origin/HEAD", "-b", branchName],
        "worktree created",
      );

      await provider.createWorkspace("task-1");

      // .forge/logs needs its parent (.forge/) to be created
      const mkdirCalls = mocks.mkdirSync.mock.calls.map((call: unknown[]) => call[0]);
      expect(mkdirCalls).toContain(`${worktreePath}/.forge`);
    });

    it("creates .env platform symlink as a file entry", async () => {
      branchCheckPasses();
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "origin/HEAD", "-b", branchName],
        "worktree created",
      );

      await provider.createWorkspace("task-1");

      const envCall = mocks.symlinkSync.mock.calls.find(
        (call: unknown[]) => (call[1] as string) === `${worktreePath}/.env`,
      );
      expect(envCall).toBeDefined();
      // File entries get a relative link without a trailing slash
      expect(envCall![0]).toBe("../../../.env");
    });

    it("passes step-level symlinks from options", async () => {
      mocks.addExistingPath(`${repoRoot}/custom-config`);

      branchCheckPasses();
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "origin/HEAD", "-b", branchName],
        "worktree created",
      );

      await provider.createWorkspace("task-1", { symlinks: ["custom-config"] });

      // 4 platform + 1 step-level
      expect(mocks.symlinkSync).toHaveBeenCalledTimes(5);

      const symlinkTargets = mocks.symlinkSync.mock.calls.map((call: unknown[]) => call[1]);
      expect(symlinkTargets).toContain(`${worktreePath}/custom-config`);
    });

    it("skips symlink when target directory already exists (tracked in git)", async () => {
      // .pi is tracked in git, so the worktree already contains it
      mocks.addExistingPath(`${worktreePath}/.pi`);

      branchCheckPasses();
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "origin/HEAD", "-b", branchName],
        "worktree created",
      );

      await provider.createWorkspace("task-1");

      // lstatSync should have been consulted
      expect(mocks.lstatSync).toHaveBeenCalled();
      // symlinkSync should NOT be called for .pi (it already exists)
      const piSymlinkCalls = mocks.symlinkSync.mock.calls.filter((call: unknown[]) =>
        (call[1] as string).endsWith(".pi"),
      );
      expect(piSymlinkCalls).toHaveLength(0);
    });

    it("skips symlink when target symlink already points to the same source", async () => {
      mocks.addExistingPath(`${worktreePath}/.pi`);
      // lstatSync reports it's a symlink
      mocks.lstatSync.mockReturnValueOnce({
        isSymbolicLink: () => true,
      });
      // readlinkSync returns the expected relative path
      mocks.readlinkSync.mockReturnValueOnce("../../../.pi/");

      branchCheckPasses();
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "origin/HEAD", "-b", branchName],
        "worktree created",
      );

      await provider.createWorkspace("task-1");

      const piSymlinkCalls = mocks.symlinkSync.mock.calls.filter((call: unknown[]) =>
        (call[1] as string).endsWith(".pi"),
      );
      expect(piSymlinkCalls).toHaveLength(0);
    });

    it("skips symlink when target symlink points elsewhere (with warning)", async () => {
      mocks.addExistingPath(`${worktreePath}/.pi`);
      mocks.lstatSync.mockReturnValueOnce({
        isSymbolicLink: () => true,
      });
      mocks.readlinkSync.mockReturnValueOnce("/some/other/path");

      branchCheckPasses();
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "origin/HEAD", "-b", branchName],
        "worktree created",
      );

      await provider.createWorkspace("task-1");

      const piSymlinkCalls = mocks.symlinkSync.mock.calls.filter((call: unknown[]) =>
        (call[1] as string).endsWith(".pi"),
      );
      expect(piSymlinkCalls).toHaveLength(0);
    });

    it("skips symlink when lstatSync throws on existing target", async () => {
      mocks.addExistingPath(`${worktreePath}/.pi`);
      mocks.lstatSync.mockImplementationOnce(() => {
        throw new Error("EACCES");
      });

      branchCheckPasses();
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "origin/HEAD", "-b", branchName],
        "worktree created",
      );

      await provider.createWorkspace("task-1");

      const piSymlinkCalls = mocks.symlinkSync.mock.calls.filter((call: unknown[]) =>
        (call[1] as string).endsWith(".pi"),
      );
      expect(piSymlinkCalls).toHaveLength(0);
    });

    it("preserves trailing slash for directory symlink entries", async () => {
      mocks.addExistingPath(`${repoRoot}/docs`);

      branchCheckPasses();
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "origin/HEAD", "-b", branchName],
        "worktree created",
      );

      await provider.createWorkspace("task-1", { symlinks: ["docs/"] });

      const docsCall = mocks.symlinkSync.mock.calls.find(
        (call: unknown[]) => (call[1] as string) === `${worktreePath}/docs`,
      );
      expect(docsCall).toBeDefined();
      // Directory entries keep the trailing slash on the relative link target
      expect(docsCall![0]).toBe("../../../docs/");
    });
  });

  describe("createWorkspace — branch option", () => {
    const existingBranch = "feature/existing";

    beforeEach(() => {
      mocks.reset();
    });

    it("reuses existing branch without -b flag", async () => {
      const p = new GitWorktreeProvider(repoRoot);
      // branchExists returns the branch (branch exists)
      mocks.willSucceed("git", ["branch", "--list", existingBranch], `  ${existingBranch}`);
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, existingBranch],
        "worktree created",
      );

      const path = await p.createWorkspace("task-1", { branch: existingBranch });
      expect(path).toBe(worktreePath);
    });

    it("creates new branch with -b when explicit branch does not exist", async () => {
      const p = new GitWorktreeProvider(repoRoot);
      // branch not found locally
      mocks.willSucceed("git", ["branch", "--list", existingBranch], "");
      // also not found on remote
      mocks.willSucceed("git", ["ls-remote", "--heads", "origin", existingBranch], "");
      mocks.willSucceed("git", ["remote"], "origin\n");
      mocks.willSucceed("git", ["fetch", "origin"], "");
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "origin/HEAD", "-b", existingBranch],
        "worktree created",
      );

      const path = await p.createWorkspace("task-1", { branch: existingBranch });
      expect(path).toBe(worktreePath);

      // remote refs are refreshed before the new branch is created from origin/HEAD
      const calls = mocks.execFile.mock.calls.map(
        (call: unknown[]) => `${String(call[0])}::${JSON.stringify(call[1])}`,
      );
      expect(calls).toContain(`git::${JSON.stringify(["fetch", "origin"])}`);
    });

    it("falls back to local HEAD when origin/HEAD cannot be resolved for an explicit new branch", async () => {
      const p = new GitWorktreeProvider(repoRoot);
      // branch not found locally or on remote
      mocks.willSucceed("git", ["branch", "--list", existingBranch], "");
      mocks.willSucceed("git", ["ls-remote", "--heads", "origin", existingBranch], "");
      // fetch fails (e.g. remote unreachable) and origin/HEAD does not exist
      mocks.willSucceed("git", ["remote"], "origin\n");
      mocks.willFail(
        "git",
        ["fetch", "origin"],
        "fatal: 'origin' does not appear to be a git repository",
      );
      mocks.willFail(
        "git",
        ["rev-parse", "--verify", "origin/HEAD^{commit}"],
        "fatal: Needed a single revision",
      );
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "HEAD", "-b", existingBranch],
        "worktree created",
      );

      const path = await p.createWorkspace("task-1", { branch: existingBranch });
      expect(path).toBe(worktreePath);

      // The worktree was created from the local HEAD fallback, not origin/HEAD
      const calls = mocks.execFile.mock.calls.map(
        (call: unknown[]) => `${String(call[0])}::${JSON.stringify(call[1])}`,
      );
      expect(calls).toContain(
        `git::${JSON.stringify(["worktree", "add", worktreePath, "HEAD", "-b", existingBranch])}`,
      );
      expect(calls).not.toContain(
        `git::${JSON.stringify(["worktree", "add", worktreePath, "origin/HEAD", "-b", existingBranch])}`,
      );
    });

    it("does not fetch origin when reusing an existing branch", async () => {
      const p = new GitWorktreeProvider(repoRoot);
      mocks.willSucceed("git", ["branch", "--list", existingBranch], `  ${existingBranch}`);
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, existingBranch],
        "worktree created",
      );

      await p.createWorkspace("task-1", { branch: existingBranch });

      // Branch reuse must never trigger the best-effort fetch
      const calls = mocks.execFile.mock.calls.map(
        (call: unknown[]) => `${String(call[0])}::${JSON.stringify(call[1])}`,
      );
      expect(calls).not.toContain(`git::${JSON.stringify(["fetch", "origin"])}`);
    });

    it("fetches and reuses branch found on remote but not locally", async () => {
      const p = new GitWorktreeProvider(repoRoot);
      const remoteBranch = "feature/remote-only";
      // branch not found locally
      mocks.willSucceed("git", ["branch", "--list", remoteBranch], "");
      // but found on remote
      mocks.willSucceed(
        "git",
        ["ls-remote", "--heads", "origin", remoteBranch],
        "abc123\trefs/heads/feature/remote-only",
      );
      // fetch it
      mocks.willSucceed("git", ["fetch", "origin", remoteBranch + ":" + remoteBranch], "");
      // then reuse (no -b)
      mocks.willSucceed("git", ["worktree", "add", worktreePath, remoteBranch], "worktree created");

      const path = await p.createWorkspace("task-1", { branch: remoteBranch });
      expect(path).toBe(worktreePath);
    });

    it("skips branch-conflict check when explicit branch is provided", async () => {
      const p = new GitWorktreeProvider(repoRoot);
      // The key assertion: assertNoConflictingBranch is NOT called.
      // Even though the branch exists, we should succeed (no WorktreeBranchExistsError).
      mocks.willSucceed("git", ["branch", "--list", existingBranch], `  ${existingBranch}`);
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, existingBranch],
        "worktree created",
      );

      await expect(p.createWorkspace("task-1", { branch: existingBranch })).resolves.toBe(
        worktreePath,
      );
    });
  });
});
