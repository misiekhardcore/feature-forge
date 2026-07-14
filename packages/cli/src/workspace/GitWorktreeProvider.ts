import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { ForgeConfig } from "../config";
import { logger } from "../logging";
import {
  WorkspaceError,
  WorktreeBranchExistsError,
  WorktreePathExistsError,
} from "./WorkspaceError";
import { WorkspaceProvider } from "./WorkspaceProvider";

/**
 * Concrete {@link WorkspaceProvider} that uses `git worktree` for isolation.
 *
 * Worktree path: `<repoRoot>/.forge/worktrees/<workspaceId>`
 * Branch name: `forge/<workspaceId>`
 */
/** Platform-level symlinks created in every worktree. */
const PLATFORM_SYMLINKS = [".pi", ".forge/logs", ".forge/worktrees.json"];

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
   * @param baseRef — Git ref to create the worktree from. Defaults to `"HEAD"`.
   */
  constructor(repoRoot?: string, baseRef = "HEAD") {
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
   */
  public override async createWorkspace(
    workspaceId: string,
    options?: import("./WorkspaceProvider").CreateWorkspaceOptions,
  ): Promise<string> {
    const worktreePath = this.getWorktreePath(workspaceId);
    const branchName = this.getBranchName(workspaceId);
    logger.info("Creating workspace", { path: worktreePath, branch: branchName });

    await this.assertNoConflictingBranch(branchName);
    await this.assertNoStalePath(worktreePath);

    await this.execCommand("git", [
      "worktree",
      "add",
      worktreePath,
      this.baseRef,
      "-b",
      branchName,
    ]);

    this.resolveSymlinks(worktreePath, options?.symlinks);

    return worktreePath;
  }

  /**
   * Remove the worktree and prune git worktree metadata.
   *
   * Safe to call multiple times — subsequent calls are no-ops if the
   * path no longer exists.
   */
  public override async destroyWorkspace(path: string): Promise<void> {
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

  private resolveSymlinks(worktreePath: string, stepSymlinks?: readonly string[]): void {
    // Read configured worktree symlinks from ForgeConfig if available,
    // falling back to the FORGE_WORKTREE_SYMLINKS env var.
    const config = ForgeConfig.getInstance();
    const configSymlinks: readonly string[] = config ? config.getWorktreeSymlinks() : [];
    // FORGE_WORKTREE_SYMLINKS env var is not supported as a fallback — use config only.

    const allSymlinks = [...PLATFORM_SYMLINKS, ...configSymlinks, ...(stepSymlinks ?? [])];

    const unique = [...new Set(allSymlinks)];

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
      const targetParent = dirname(target);
      if (!existsSync(targetParent)) {
        mkdirSync(targetParent, { recursive: true });
      }

      symlinkSync(relative(dirname(target), source), target);
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
