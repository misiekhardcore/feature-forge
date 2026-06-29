import { execFile } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";

import { logger } from "../logging";
import { WorkspaceError, WorktreeBranchExistsError } from "./WorkspaceError";
import { WorkspaceProvider } from "./WorkspaceProvider";

/**
 * Concrete {@link WorkspaceProvider} that uses Worktrunk CLI (`wt`) for
 * faster, AI-workflow-optimised worktree management.
 *
 * Worktrunk chooses its own directory — the provider does not pre-compute
 * the worktree path. Instead it parses it from `wt switch -c` stdout.
 *
 * Falls back to {@link GitWorktreeProvider} when Worktrunk is not available.
 */
export class WorktrunkProvider extends WorkspaceProvider {
  /** Absolute path to the root of the git repository. */
  public readonly repoRoot: string;

  constructor(repoRoot?: string) {
    super();
    this.repoRoot = repoRoot ?? process.cwd();
  }

  /**
   * Check whether Worktrunk CLI is available on this system.
   *
   * Probes `wt switch --help` rather than `wt --version` to avoid false
   * positives from other tools named `wt` (e.g., Go's webtool).
   */
  static async canActivate(repoRoot?: string): Promise<boolean> {
    try {
      await WorktrunkProvider.execCommandStatic(repoRoot ?? process.cwd(), "wt", [
        "switch",
        "--help",
      ]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a worktree via Worktrunk.
   *
   * `wt switch -c <branch>` creates a new branch and worktree in one command.
   * Worktrunk chooses its own directory and prints the path on stdout.
   */
  public override async createWorkspace(workspaceId: string): Promise<string> {
    const branchName = this.getBranchName(workspaceId);

    await this.assertNoConflictingBranch(branchName);

    const stdout = await this.execCommand("wt", ["switch", "-c", branchName]);

    return this.parseWtPath(stdout);
  }

  /**
   * Remove the worktree via `git worktree remove` (the worktree is still a
   * git worktree even when created by Worktrunk) and prune stale metadata.
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

  private getBranchName(workspaceId: string): string {
    return `forge/${workspaceId}`;
  }

  /**
   * Parse the worktree path from Worktrunk's stdout.
   *
   * Worktrunk output looks like:
   * `✓ Created branch forge/myid from main and worktree @ ~/Projects/feature-forge.myid`
   *
   * The path follows the last ` @ ` on the last line. Tilde (`~`) is expanded
   * to the user's home directory.
   */
  private parseWtPath(stdout: string): string {
    const lines = stdout.trim().split("\n");
    const lastLine = lines[lines.length - 1]?.trim();
    if (!lastLine) {
      throw new WorkspaceError("Worktrunk returned no path in output");
    }

    const atIndex = lastLine.lastIndexOf(" @ ");
    const rawPath = atIndex !== -1 ? lastLine.slice(atIndex + 3).trim() : lastLine;

    if (!rawPath) {
      throw new WorkspaceError("Worktrunk returned no path in output");
    }

    return rawPath.startsWith("~/") || rawPath === "~" ? rawPath.replace(/^~/, homedir()) : rawPath;
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
    return WorktrunkProvider.execCommandStatic(this.repoRoot, command, args);
  }

  private static async execCommandStatic(
    cwd: string,
    command: string,
    args: string[],
  ): Promise<string> {
    return new Promise<string>((resolvePromise, reject) => {
      execFile(command, args, { cwd, timeout: 30_000 }, (error, stdout, stderr) => {
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
