import { execFile } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { ForgeConfig, logger } from "@feature-forge/shared";

import {
  WorkspaceError,
  WorktreeBranchExistsError,
  WorktreePathExistsError,
} from "./WorkspaceError";
import { CreateWorkspaceOptions, WorkspaceProvider } from "./WorkspaceProvider";

/**
 * Concrete {@link WorkspaceProvider} that uses `git worktree` for isolation.
 *
 * Worktree path: `<repoRoot>/.forge/worktrees/<workspaceId>`
 * Branch name: `forge/<workspaceId>`
 */
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
    options?: CreateWorkspaceOptions,
  ): Promise<string> {
    const worktreePath = this.getWorktreePath(workspaceId);
    const branchName = options?.branch ?? this.getBranchName(workspaceId);
    logger.info("Creating workspace", { path: worktreePath, branch: branchName });

    await this.assertNoStalePath(worktreePath);

    // effectiveBaseRef determines the starting commit for new worktrees.
    // It matters when creating a branch from a ref (the "new branch" path
    // below). When branch is set and already exists, we just check it out
    // directly — no ref needed.
    const effectiveBaseRef = options?.baseRef ?? this.baseRef;

    if (options?.branch) {
      // Explicit branch — allow reusing an existing branch (e.g. adding to open PR).
      const exists = await this.branchExists(branchName);
      if (exists) {
        logger.info("Reusing existing branch", { branch: branchName });
        await this.execCommand("git", ["worktree", "add", worktreePath, branchName]);
      } else {
        await this.execCommand("git", [
          "worktree",
          "add",
          worktreePath,
          effectiveBaseRef,
          "-b",
          branchName,
        ]);
      }
    } else {
      // Default generated branch — must not already exist.
      await this.assertNoConflictingBranch(branchName);
      await this.execCommand("git", [
        "worktree",
        "add",
        worktreePath,
        effectiveBaseRef,
        "-b",
        branchName,
      ]);
    }

    this.resolveSymlinks(worktreePath, options?.symlinks);
    this.excludeFromGit();

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

  /**
   * Ensure the platform's own symlinks (e.g. `.pi`) never appear as untracked
   * dirt in `git status` — otherwise a clean-tree check like `open_pr`'s
   * `check-clean` step would false-positive on every run.
   *
   * Linked worktrees have no writable local exclude file (`.git` is a pointer
   * file, so `<worktree>/.git/info/exclude` is ignored by git), therefore the
   * entries are appended to the shared `<repoRoot>/.git/info/exclude`.
   * Idempotent: entries already present under the marker are not re-added.
   */
  private excludeFromGit(): void {
    const excludePath = join(this.repoRoot, ".git", "info", "exclude");
    const marker = "# forge worktree symlinks";

    let content = "";
    try {
      content = readFileSync(excludePath, "utf-8");
    } catch {
      // Missing exclude file (uninitialized repo) — start fresh.
    }

    const lines = content.split("\n");
    const existing = new Set(lines.filter((l) => l.trim().length > 0 && !l.trim().startsWith("#")));
    const toAdd = [...new Set(PLATFORM_SYMLINKS)].filter(
      (entry) => !existing.has(entry) && !existing.has(entry + "/"),
    );
    if (toAdd.length === 0) {
      return;
    }

    const block = `${marker}\n${toAdd.join("\n")}`;
    const prefix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
    try {
      appendFileSync(excludePath, `${prefix}${block}\n`, "utf-8");
    } catch (error) {
      logger.warn("Could not append to git exclude file", { excludePath, error });
    }
  }

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

      symlinkSync(this.relativeLinkTarget(dirname(target), source, symlink), target);
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
