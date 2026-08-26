import { execFile } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { ForgeConfig } from "../config";
import { logger } from "../logging";
import {
  WorkspaceError,
  WorktreeBranchExistsError,
  WorktreePathExistsError,
} from "./WorkspaceError";
import { CreateWorkspaceOptions, WorkspaceProvider } from "./WorkspaceProvider";

/** Default base ref: the remote's tip, refreshed best-effort before use. */
const DEFAULT_BASE_REF = "origin/HEAD";

/** Fallback base ref when the default cannot be resolved (e.g. no origin remote). */
const FALLBACK_BASE_REF = "HEAD";

/** Platform-level symlinks created in every worktree. */
const PLATFORM_SYMLINKS = [
  ".pi/",
  ".forge/logs/",
  ".forge/skills/",
  ".forge/worktrees.json",
  ".env",
];

/**
 * Concrete {@link WorkspaceProvider} that uses `git worktree` for isolation.
 *
 * Worktree path: `<repoRoot>/.forge/worktrees/<workspaceId>`
 * Branch name: `forge/<workspaceId>`
 */
export class GitWorktreeProvider extends WorkspaceProvider {
  /** Absolute path to the root of the git repository. */
  public readonly repoRoot: string;
  /** Base ref to create the worktree from. Immutable after construction. */
  public readonly baseRef: string;

  /**
   * @param repoRoot — Absolute path to the repository root. Defaults to `process.cwd()`.
   * @param baseRef - Git ref to create the worktree from. Defaults to `"origin/HEAD"`
   * so new worktrees branch from the remote's tip rather than a possibly
   * stale local `HEAD`. When this instance uses the default `origin/HEAD`
   * base, remote refs are refreshed best-effort before each new worktree
   * and the base falls back to the local `HEAD` if `origin/HEAD` cannot be
   * resolved (e.g. the repo has no `origin` remote) - creation never
   * blocks offline.
   */
  constructor(repoRoot?: string, baseRef = DEFAULT_BASE_REF) {
    super();
    this.repoRoot = repoRoot ?? process.cwd();
    this.baseRef = baseRef;
  }

  /**
   * Check whether this directory is inside a git repository.
   */
  static async canActivate(repoRoot?: string): Promise<boolean> {
    try {
      await GitWorktreeProvider.execCommandStatic(repoRoot ?? process.cwd(), "git", [
        "rev-parse",
        "--is-inside-work-tree",
      ]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a git worktree at `.forge/worktrees/<workspaceId>`.
   *
   * Checks that neither the branch nor the target path already exist,
   * then calls `git worktree add`. The dirty-tree state of the main
   * repo is not checked — worktrees are created from the commit, not
   * the working tree.
   *
   * Before creating a *new* worktree (generated branch or explicit branch
   * that does not exist yet) from the default `origin/HEAD` base, remote
   * refs are refreshed best-effort so `origin/HEAD` resolves to a recent
   * commit; a failed fetch or unresolvable `origin/HEAD` falls back to the
   * local `HEAD` and never blocks creation. Explicitly provided base refs
   * are used as-is (no fetch, no fallback). Reusing an existing branch
   * performs no `origin/HEAD` refresh (`branchExists` may still fetch a
   * remote-only branch by name - targeted, not a full refresh).
   */
  public override async createWorkspace(
    workspaceId: string,
    options?: CreateWorkspaceOptions,
  ): Promise<string> {
    const worktreePath = this.getWorktreePath(workspaceId);
    const branchName = options?.branch ?? this.getBranchName(workspaceId);
    logger.info("Creating workspace", { path: worktreePath, branch: branchName });

    await this.assertNoStalePath(worktreePath);

    // effectiveBaseRef determines the starting commit for new worktrees.
    // It matters when creating a branch from a ref (the "new branch" path
    // below). When branch is set and already exists, we just check it out
    // directly - no ref needed.
    const effectiveBaseRef = options?.baseRef ?? this.baseRef;

    if (options?.branch) {
      // Explicit branch - allow reusing an existing branch (e.g. adding to open PR).
      const exists = await this.branchExists(branchName);
      if (exists) {
        logger.info("Reusing existing branch", { branch: branchName });
        await this.execCommand("git", ["worktree", "add", worktreePath, branchName]);
      } else {
        // New branch from an explicit ref.
        const baseRef = await this.resolveNewWorktreeBaseRef(effectiveBaseRef);
        await this.execCommand("git", ["worktree", "add", worktreePath, baseRef, "-b", branchName]);
      }
    } else {
      // Default generated branch - must not already exist.
      await this.assertNoConflictingBranch(branchName);
      const baseRef = await this.resolveNewWorktreeBaseRef(effectiveBaseRef);
      await this.execCommand("git", ["worktree", "add", worktreePath, baseRef, "-b", branchName]);
    }

    await this.resolveSymlinks(worktreePath, options?.symlinks);

    return worktreePath;
  }

  /**
   * Remove the worktree and prune git worktree metadata.
   *
   * Safe to call multiple times — subsequent calls are no-ops if the
   * path no longer exists.
   *
   * @param branch — Optional branch name to delete after worktree removal.
   * Best-effort: failure is logged but never thrown.
   */
  public override async destroyWorkspace(path: string, branch?: string): Promise<void> {
    if (!existsSync(path)) {
      return;
    }

    try {
      await this.execCommand("git", ["worktree", "remove", path, "--force"]);
    } catch (error) {
      logger.warn("Worktree remove fallback", { path, error });
      try {
        rmSync(path, { recursive: true, force: true });
      } catch (error) {
        logger.warn("Directory removal fallback", { path, error });
      }
    }

    try {
      await this.execCommand("git", ["worktree", "prune"]);
    } catch (error) {
      logger.warn("Prune failed", { error });
    }

    if (branch) {
      try {
        await this.execCommand("git", ["branch", "-D", branch]);
      } catch (error) {
        logger.warn("Branch deletion failed", { branch, error });
      }
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────

  private getWorktreePath(workspaceId: string): string {
    return resolve(join(this.repoRoot, ".forge", "worktrees", workspaceId));
  }

  private getBranchName(workspaceId: string): string {
    return `forge/${workspaceId}`;
  }

  private async assertNoStalePath(worktreePath: string): Promise<void> {
    if (existsSync(worktreePath)) {
      throw new WorktreePathExistsError(worktreePath);
    }
  }

  private async resolveSymlinks(
    worktreePath: string,
    stepSymlinks?: readonly string[],
  ): Promise<void> {
    // Read configured worktree symlinks from ForgeConfig if available,
    const config = ForgeConfig.getInstance();
    const configSymlinks = config ? config.getWorktreeSymlinks() : [];

    const allSymlinks = [...PLATFORM_SYMLINKS, ...configSymlinks, ...(stepSymlinks ?? [])];

    const unique = [
      ...new Map(allSymlinks.map((s): [string, string] => [s.replace(/\/$/, ""), s])).values(),
    ];

    for (const symlink of unique) {
      // Guard: never symlink into .forge/worktrees/ directory (prevents recursive nesting).
      // Use a trailing slash to avoid matching files like .forge/worktrees.json.
      if (symlink === ".forge/worktrees" || symlink.startsWith(".forge/worktrees/")) {
        continue;
      }

      const source = resolve(this.repoRoot, symlink);
      if (!existsSync(source)) {
        logger.warn("Symlink source does not exist", { symlink, source });
        continue;
      }

      const target = resolve(worktreePath, symlink);

      // When the target already exists (e.g. directory tracked in git and
      // materialised by git worktree add), skip instead of failing with EEXIST.
      if (existsSync(target)) {
        try {
          const stat = lstatSync(target);
          if (stat.isSymbolicLink()) {
            const existingLink = readlinkSync(target);
            const expectedLink = this.relativeLinkTarget(dirname(target), source, symlink);
            if (existingLink === expectedLink) {
              continue;
            }
            logger.warn("Symlink target exists but points elsewhere", {
              symlink,
              target,
              existingLink,
              expectedLink,
            });
          } else {
            logger.debug("Symlink target already exists, skipping", { symlink, target });
          }
        } catch {
          logger.debug("Could not stat existing symlink target, skipping", { symlink, target });
        }
        continue;
      }

      const targetParent = dirname(target);
      if (!existsSync(targetParent)) {
        mkdirSync(targetParent, { recursive: true });
      }

      symlinkSync(
        this.relativeLinkTarget(dirname(target), source, symlink),
        target,
        lstatSync(source).isDirectory() ? "dir" : "file",
      );
    }
  }

  /**
   * Compute the relative symlink target for a worktree entry. Entries ending
   * in `/` denote directories; the trailing slash is preserved so the created
   * symlink resolves as a directory link.
   */
  private relativeLinkTarget(linkDir: string, source: string, entry: string): string {
    const link = relative(linkDir, source);
    return entry.endsWith("/") ? `${link}/` : link;
  }

  private async branchExists(branchName: string): Promise<boolean> {
    // Check local branches first.
    try {
      const output = await this.execCommand("git", ["branch", "--list", branchName]);
      if (output.trim().length > 0) return true;
    } catch (error) {
      logger.debug("Local branch check failed", { branchName, error });
    }

    // If not found locally, check remote; fetch if it exists there.
    try {
      const remoteOutput = await this.execCommand("git", [
        "ls-remote",
        "--heads",
        "origin",
        branchName,
      ]);
      if (remoteOutput.trim().length > 0) {
        logger.info("Branch found on remote, fetching", { branchName });
        await this.execCommand("git", ["fetch", "origin", `${branchName}:${branchName}`]);
        return true;
      }
    } catch (error) {
      logger.debug("Remote branch check failed", { branchName, error });
    }

    return false;
  }

  /**
   * Resolve the ref a *new* worktree is created from.
   *
   * For the default `origin/HEAD` base, remote refs are refreshed
   * best-effort first and the ref is verified to resolve to a commit. If it
   * still cannot be resolved (e.g. the repo has no `origin` remote, or the
   * fetch failed), the base falls back to the local `HEAD` so worktree
   * creation never blocks offline.
   *
   * Explicitly provided base refs are returned unchanged - no fetch, no
   * fallback.
   */
  private async resolveNewWorktreeBaseRef(effectiveBaseRef: string): Promise<string> {
    if (effectiveBaseRef !== DEFAULT_BASE_REF) {
      return effectiveBaseRef;
    }
    await this.refreshRemoteRefs();
    if (await this.refResolves(effectiveBaseRef)) {
      return effectiveBaseRef;
    }
    logger.warn("Base ref does not resolve; falling back to local HEAD", {
      baseRef: effectiveBaseRef,
    });
    return FALLBACK_BASE_REF;
  }

  /**
   * Best-effort refresh of remote refs so the default base ref
   * (`origin/HEAD`) resolves to a recent commit. Skips the fetch entirely
   * when no `origin` remote is configured (a normal local-only state, not
   * an error). Failures are logged as a warning and swallowed - a stale
   * base is preferable to failing worktree creation entirely.
   */
  private async refreshRemoteRefs(): Promise<void> {
    try {
      const remotes = await this.execCommand("git", ["remote"]);
      if (!remotes.split(/\r?\n/).some((line) => line.trim() === "origin")) {
        return;
      }
      await this.execCommand("git", ["fetch", "origin"]);
    } catch (error) {
      logger.warn("Remote ref refresh failed; continuing with existing refs", { error });
    }
  }

  /**
   * Whether a git ref resolves to a commit. Best-effort: failures return
   * false rather than throwing.
   */
  private async refResolves(ref: string): Promise<boolean> {
    try {
      await this.execCommand("git", ["rev-parse", "--verify", `${ref}^{commit}`]);
      return true;
    } catch (error) {
      logger.debug("Base ref resolve check failed", { ref, error });
      return false;
    }
  }

  private async assertNoConflictingBranch(branchName: string): Promise<void> {
    try {
      const output = await this.execCommand("git", ["branch", "--list", branchName]);
      if (output.trim().length > 0) {
        throw new WorktreeBranchExistsError(branchName);
      }
    } catch (error) {
      logger.debug("Branch check failed", { branchName, error });
      if (error instanceof WorktreeBranchExistsError) {
        throw error;
      }
    }
  }

  private async execCommand(command: string, args: string[]): Promise<string> {
    return GitWorktreeProvider.execCommandStatic(this.repoRoot, command, args);
  }

  private static async execCommandStatic(
    cwd: string,
    command: string,
    args: string[],
    signal?: AbortSignal,
  ): Promise<string> {
    return new Promise<string>((resolvePromise, reject) => {
      execFile(command, args, { cwd, timeout: 30_000, signal }, (error, stdout, stderr) => {
        if (error) {
          const message = stderr?.trim() || error.message;
          reject(
            new WorkspaceError(`Command failed: ${command} ${args.join(" ")}\n${message}`, error),
          );
        } else {
          resolvePromise(stdout);
        }
      });
    });
  }
}
