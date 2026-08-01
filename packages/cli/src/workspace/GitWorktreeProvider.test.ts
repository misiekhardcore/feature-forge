import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock setup ───────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const execFile = vi.fn();
  const appendFileSync = vi.fn();
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
    appendFileSync.mockReset();
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
    get appendFileSync() {
      return appendFileSync;
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
    appendFileSync: mocks.appendFileSync,
  };
});

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
    provider = new GitWorktreeProvider(repoRoot, "HEAD");
  });

  // ── Constructor ──────────────────────────────────────────────────────

  describe("constructor", () => {
    it("defaults repoRoot to process.cwd()", () => {
      const p = new GitWorktreeProvider(undefined, "HEAD");
      expect(p.repoRoot).toBe(process.cwd());
    });

    it("accepts a custom repoRoot", () => {
      expect(provider.repoRoot).toBe(repoRoot);
    });

    it("defaults baseRef to HEAD", () => {
      const p = new GitWorktreeProvider(repoRoot, undefined);
      expect(p.baseRef).toBe("HEAD");
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
        ["worktree", "add", worktreePath, "HEAD", "-b", branchName],
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
      // The worktree's local git exclude file is resolved via git; from the
      // main checkout git returns the path relative to its cwd
      mocks.willSucceed("git", ["rev-parse", "--git-path", "info/exclude"], ".git/info/exclude");
    });

    it("creates platform symlinks after worktree creation", async () => {
      branchCheckPasses();
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "HEAD", "-b", branchName],
        "worktree created",
      );

      await provider.createWorkspace("task-1");

      // Platform symlinks should have been created
      expect(mocks.symlinkSync).toHaveBeenCalledTimes(4);

      // .pi lives at the root of the worktree, so parent dir exists
      expect(mocks.symlinkSync).toHaveBeenCalledWith(
        expect.stringContaining(".."),
        `${worktreePath}/.pi`,
      );

      // The applicable paths are appended to the repository-local git exclude
      // file so git never stages the symlinks (trailing-slash .gitignore
      // patterns do not match symlinks).
      expect(mocks.appendFileSync).toHaveBeenCalledTimes(1);
      expect(mocks.appendFileSync).toHaveBeenCalledWith(
        "/home/user/my-repo/.git/info/exclude",
        "\n# worktree symlinks (auto-generated by feature-forge)\n/.pi\n/.forge/logs\n/.forge/skills\n/.forge/worktrees.json\n/.env\n",
      );
    });

    it("merges all three sources with dedup", async () => {
      mocks.addExistingPath(`${repoRoot}/.pi/`);

      branchCheckPasses();
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "HEAD", "-b", branchName],
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
        ["worktree", "add", worktreePath, "HEAD", "-b", branchName],
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
        ["worktree", "add", worktreePath, "HEAD", "-b", branchName],
        "worktree created",
      );

      await provider.createWorkspace("task-1", { symlinks: ["nonexistent-dir"] });

      // 4 platform symlinks (nonexistent-dir is skipped)
      expect(mocks.symlinkSync).toHaveBeenCalledTimes(4);

      // Verify the nonexistent env symlink was NOT created
      const symlinkTargets = mocks.symlinkSync.mock.calls.map((call: unknown[]) => call[1]);
      expect(symlinkTargets).not.toContain(`${worktreePath}/nonexistent-dir`);

      // The exclude file still covers the skipped path - exclusion applies to
      // all applicable paths regardless of whether the source exists.
      expect(mocks.appendFileSync).toHaveBeenCalledWith(
        "/home/user/my-repo/.git/info/exclude",
        "\n# worktree symlinks (auto-generated by feature-forge)\n/.pi\n/.forge/logs\n/.forge/skills\n/.forge/worktrees.json\n/.env\n/nonexistent-dir\n",
      );
    });

    it("guards against .forge/worktrees/ symlinks", async () => {
      mocks.addExistingPath(`${repoRoot}/.forge/worktrees/evil`);

      branchCheckPasses();
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "HEAD", "-b", branchName],
        "worktree created",
      );

      await provider.createWorkspace("task-1", { symlinks: [".forge/worktrees/evil"] });

      // .forge/worktrees/evil should NOT be symlinked (would cause recursive nesting)
      const symlinkTargets = mocks.symlinkSync.mock.calls.map((call: unknown[]) => call[1]);
      expect(symlinkTargets).not.toContain(`${worktreePath}/.forge/worktrees/evil`);

      // ...and must not be written to the exclude file either
      expect(mocks.appendFileSync).toHaveBeenCalledTimes(1);
      expect(String(mocks.appendFileSync.mock.calls[0][1])).not.toContain(".forge/worktrees/evil");
    });

    it("creates parent directories for nested symlink targets", async () => {
      branchCheckPasses();
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "HEAD", "-b", branchName],
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
        ["worktree", "add", worktreePath, "HEAD", "-b", branchName],
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
        ["worktree", "add", worktreePath, "HEAD", "-b", branchName],
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
        ["worktree", "add", worktreePath, "HEAD", "-b", branchName],
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
        ["worktree", "add", worktreePath, "HEAD", "-b", branchName],
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
        ["worktree", "add", worktreePath, "HEAD", "-b", branchName],
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
        ["worktree", "add", worktreePath, "HEAD", "-b", branchName],
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
        ["worktree", "add", worktreePath, "HEAD", "-b", branchName],
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
      mocks.willSucceed(
        "git",
        ["worktree", "add", worktreePath, "HEAD", "-b", existingBranch],
        "worktree created",
      );

      const path = await p.createWorkspace("task-1", { branch: existingBranch });
      expect(path).toBe(worktreePath);
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
