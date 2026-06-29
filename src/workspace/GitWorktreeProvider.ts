import { execFile } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { logger } from "../logging";
import {
  WorkspaceError,
  WorktreeBranchExistsError,
  WorktreePathExistsError,
} from "./WorkspaceError";
import { WorkspaceProvider } from "./WorkspaceProvider";

/**
 * Concrete {@link WorkspaceProvider} that uses git worktrees for isolation.
 *
 * Tries Worktrunk CLI (`wt add`) first (faster, purpose-built for AI workflows),
 * then falls back to `git worktree add`.
 *
 * Worktree path: `<repoRoot>/.forge/worktrees/<workspaceId>`
 *
 * The branch name is derived from the workspace id: `forge/<workspaceId>`.
 */
export class GitWorktreeProvider extends WorkspaceProvider {
  /** Absolute path to the root of the git repository. */
  public readonly repoRoot: string;
  /** Base ref to create the worktree from. Immutable after construction. */
  public readonly baseRef: string;

  constructor(repoRoot?: string, baseRef = "HEAD") {
    super();
    this.repoRoot = repoRoot ?? process.cwd();
    this.baseRef = baseRef;
  }

  /**
   * Create a git worktree at `.forge/worktrees/<workspaceId>`.
   *
   * 1. Checks that neither the branch nor the target path already exist.
   * 2. Attempts Worktrunk (`wt add`), falls back to `git worktree add`.
   *
   * When Worktrunk is used, `wt` chooses its own directory and returns the
   * path in stdout — the pre-computed path is ignored in that case.
   */
  public override async createWorkspace(workspaceId: string): Promise<string> {
    const worktreePath = this.getWorktreePath(workspaceId);
    const branchName = this.getBranchName(workspaceId);

    // Safety checks
    await this.assertNoConflictingBranch(branchName);

    // Try Worktrunk first, then fall back to git worktree.
    // Worktrunk chooses its own directory and returns the path on stdout.
    const wtCli = await this.findWorktrunk();
    if (wtCli) {
      const stdout = await this.execCommand(wtCli, [
        "add",
        "--base-ref",
        this.baseRef,
        "--branch",
        branchName,
      ]);
      return this.parseWtPath(stdout);
    }

    await this.assertNoStalePath(worktreePath);
    await this.execCommand("git", [
      "worktree",
      "add",
      worktreePath,
      this.baseRef,
      "-b",
      branchName,
    ]);

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
      // Fallback: if git worktree remove failed (e.g., corrupted worktree),
      // force-remove the directory then prune stale git metadata.
      try {
        rmSync(path, { recursive: true, force: true });
      } catch (error) {
        logger.warn("Directory removal fallback", { path, error });
        // Best-effort: directory removal may fail if permissions are off.
      }
    }

    // Prune stale worktree metadata regardless
    try {
      await this.execCommand("git", ["worktree", "prune"]);
    } catch (error) {
      logger.warn("Prune failed", { error });
      // Prune is best-effort
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────

  private getWorktreePath(workspaceId: string): string {
    return resolve(join(this.repoRoot, ".forge", "worktrees", workspaceId));
  }

  private getBranchName(workspaceId: string): string {
    return `forge/${workspaceId}`;
  }

  /**
   * Parse the worktree path from Worktrunk's stdout.
   * Worktrunk emits the path as a single line (typically the last non-empty line).
   */
  private parseWtPath(stdout: string): string {
    const lines = stdout.trim().split("\n");
    const pathLine = lines[lines.length - 1]?.trim();
    if (!pathLine) {
      throw new WorkspaceError("Worktrunk returned no path in output");
    }
    return pathLine;
  }

  /**
   * Check that the target worktree path doesn't already exist.
   * A stale worktree from a prior crash would cause `git worktree add` to fail.
   */
  private async assertNoStalePath(worktreePath: string): Promise<void> {
    if (existsSync(worktreePath)) {
      throw new WorktreePathExistsError(worktreePath);
    }
  }

  /**
   * Check that the target branch name doesn't already exist locally.
   */
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
      // If `git branch --list` itself fails, proceed anyway — the actual
      // worktree creation will catch the conflict.
    }
  }

  /**
   * Check if Worktrunk CLI (`wt`) is available.
   *
   * Probes `wt add --help` rather than `wt --version` to avoid false
   * positives from other tools named `wt` (e.g., Go's webtool).
   * Returns the command name if found, or null otherwise.
   */
  private async findWorktrunk(): Promise<string | null> {
    try {
      await this.execCommand("wt", ["add", "--help"]);
      return "wt";
    } catch (error) {
      logger.debug("Worktrunk check failed", { error });
      return null;
    }
  }

  /**
   * Execute a command and return its stdout.
   * Runs in the repo root directory.
   */
  private async execCommand(command: string, args: string[]): Promise<string> {
    return new Promise<string>((resolvePromise, reject) => {
      execFile(command, args, { cwd: this.repoRoot, timeout: 30_000 }, (error, stdout, stderr) => {
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
