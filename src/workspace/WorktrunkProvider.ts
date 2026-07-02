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
 * the worktree path. Instead it parses it from `wt switch -c` output.
 *
 * Falls back to {@link GitWorktreeProvider} when Worktrunk is not available.
 */
export class WorktrunkProvider extends WorkspaceProvider {
  /** Absolute path to the root of the git repository. */
  public readonly repoRoot: string;

  /**
   * The ref to branch the worktree from.
   *
   * Worktrunk's `@` literal means "the current branch / HEAD of the source
   * repository" — i.e. whatever branch is checked out in `repoRoot` at the
   * moment `wt switch -c` runs. This is the safe default for feature-forge:
   * the builder's worktree must stem from the branch the orchestrator is
   * itself running on (typically a long-lived refactor branch), **not** from
   * whatever the repository's configured default branch happens to be.
   *
   * Callers may pass an explicit ref (e.g. `main`, `develop`, a SHA, or any
   * other string Worktrunk accepts) when they need to override this.
   *
   * See ADR 0008 for the full rationale.
   */
  public readonly baseRef: string;

  /**
   * @param repoRoot Absolute path to the source git repository. Defaults to
   *   `process.cwd()`.
   * @param baseRef Ref to create the worktree from. Defaults to `"@"` (the
   *   current branch / HEAD of `repoRoot`). See {@link baseRef} and ADR 0008.
   */
  constructor(repoRoot?: string, baseRef: string = "@") {
    super();
    this.repoRoot = repoRoot ?? process.cwd();
    this.baseRef = baseRef;
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
   * Worktrunk chooses its own directory and prints the path on stdout or stderr.
   */
  public override async createWorkspace(workspaceId: string): Promise<string> {
    const branchName = this.getBranchName(workspaceId);

    await this.assertNoConflictingBranch(branchName);

    const stdout = await this.execCommand("wt", [
      "switch",
      "-c",
      branchName,
      "--base",
      this.baseRef,
    ]);

    return this.parseWtPath(stdout);
  }

  /**
   * Remove the worktree via Worktrunk's own `wt remove` command.
   * Uses `--force` for dirty worktrees and `--yes` to skip prompts.
   * Falls back to `git worktree remove` if wt fails.
   *
   * Safe to call multiple times — subsequent calls are no-ops if the
   * path no longer exists.
   */
  public override async destroyWorkspace(path: string): Promise<void> {
    if (!existsSync(path)) {
      return;
    }

    try {
      await this.execCommand("wt", ["remove", path, "--force", "--yes", "--foreground"]);
    } catch (error) {
      logger.warn("wt remove failed, falling back to git", { path, error });
      try {
        await this.execCommand("git", ["worktree", "remove", path, "--force"]);
      } catch (error) {
        logger.warn("git worktree remove fallback", { path, error });
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
  }

  // ─── Private helpers ─────────────────────────────────────────────────

  private getBranchName(workspaceId: string): string {
    return `forge/${workspaceId}`;
  }

  /**
   * Parse the worktree path from Worktrunk's output.
   *
   * Worktrunk output looks like:
   * `✓ Created branch forge/myid from <ref> and worktree @ ~/Projects/feature-forge.myid`
   *
   * The authoritative path is the one on the line containing the literal
   * `worktree @ <path>` marker. We scan **every** line of the output (not just
   * the last one) for that marker — earlier implementations relied on the last
   * line coincidentally matching, which silently returned garbage when
   * Worktrunk appended extra output after the worktree line.
   *
   * Tilde (`~`) is expanded to the user's home directory, then the resulting
   * absolute path is **validated** against the filesystem with `existsSync`:
   * a path that Worktrunk reports but does not actually exist on disk is a
   * hard error (see ADR 0008), never a silent fallback to the whole line.
   */
  private parseWtPath(stdout: string): string {
    const lines = stdout.split("\n");

    // Scan every line for the authoritative `worktree @ <path>` marker.
    const marker = "worktree @ ";
    let worktreeLine: string | undefined;
    for (const raw of lines) {
      const trimmed = raw.trim();
      if (trimmed.includes(marker)) {
        worktreeLine = trimmed;
      }
    }

    if (!worktreeLine) {
      throw new WorkspaceError("Worktrunk output did not contain a 'worktree @ <path>' line");
    }

    const markerIndex = worktreeLine.lastIndexOf(marker);
    const rawPath = worktreeLine.slice(markerIndex + marker.length).trim();

    if (!rawPath) {
      throw new WorkspaceError("Worktrunk returned no path after 'worktree @'");
    }

    const expandedPath =
      rawPath.startsWith("~/") || rawPath === "~" ? rawPath.replace(/^~/, homedir()) : rawPath;

    if (!existsSync(expandedPath)) {
      throw new WorkspaceError(
        `Worktrunk reported a worktree path that does not exist on disk: ${expandedPath}`,
      );
    }

    return expandedPath;
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
          const output = stdout?.trim() || stderr?.trim() || "";
          if (!output) {
            reject(new WorkspaceError("Command produced no output"));
          } else {
            resolvePromise(output);
          }
        }
      });
    });
  }
}
