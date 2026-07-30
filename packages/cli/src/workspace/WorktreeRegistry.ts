import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { jsonParse, Registry } from "@feature-forge/shared";
import { logger } from "@feature-forge/shared";

import { WorkspaceError } from "./WorkspaceError";
import { WorkspaceHandle } from "./WorkspaceHandle";

const execFileAsync = promisify(execFile);

/**
 * Result of {@link WorktreeRegistry.reconcile}.
 *
 * Describes mismatches between the persisted registry, the on-disk worktree
 * directories, and local git `forge/*` branches. All array fields are empty
 * when everything is in sync.
 */
export interface ReconciliationReport {
  /** Registry entries whose paths don't exist on disk. */
  staleRegistryEntries: string[];
  /** Worktree directories in .forge/worktrees/ not tracked in the registry. */
  orphanedWorktrees: string[];
  /** Local git branches matching forge/* that have no corresponding worktree. */
  orphanedBranches: string[];
}

/**
 * Persisted registry that tracks active worktrees across sessions.
 *
 * Survives orchestrator/pi crashes because the data is stored on disk.
 * On the next startup, {@link list()} surfaces stale entries so the user
 * can decide whether to resume or destroy them.
 *
 * Storage format: JSON array of serialized {@link WorkspaceHandle} objects,
 * written to `<storagePath>` (e.g., `<repo-root>/.forge/worktrees.json`).
 */
export class WorktreeRegistry extends Registry<WorkspaceHandle> {
  constructor(private readonly storagePath = WorktreeRegistry.defaultStoragePath()) {
    super();
  }

  /**
   * Default storage path inside a repository.
   *
   * @param repoRoot — Absolute path to the repository root.
   * @returns `<repoRoot>/.forge/worktrees.json`
   */
  static defaultStoragePath = (repoRoot?: string): string => {
    return resolve(repoRoot ?? process.cwd(), ".forge", "worktrees.json");
  };

  /**
   * Register a new workspace handle and persist to disk.
   */
  async register(handle: WorkspaceHandle): Promise<void> {
    this.set(handle.path, handle);
    await this.persist();
  }

  /**
   * Remove a workspace handle by path and persist the change.
   * Safe to call for non-existent paths — becomes a no-op.
   */
  async remove(path: string): Promise<void> {
    if (!this.has(path)) {
      return;
    }
    this.unregister(path);
    await this.persist();
  }

  // ─── Persistence ─────────────────────────────────────────────────────

  /**
   * Load persisted data from disk.
   *
   * Must be called once before using the registry (typically at extension
   * startup). If the storage file doesn't exist yet, starts with an empty
   * registry.
   */
  async load(): Promise<void> {
    this.items.clear();

    if (!existsSync(this.storagePath)) {
      return;
    }

    try {
      const raw = await readFile(this.storagePath, "utf-8");
      const data = jsonParse<{ path: string; createdAt: string }[]>(raw);

      for (const entry of data) {
        const handle = WorkspaceHandle.fromJSON(entry);
        this.set(handle.path, handle);
      }
    } catch (cause) {
      logger.error("Registry load failed", { path: this.storagePath, cause });
      throw new WorkspaceError(
        `Failed to load worktree registry from ${this.storagePath}`,
        cause instanceof Error ? cause : undefined,
      );
    }
  }

  /**
   * Reconcile the persisted registry against the on-disk worktree directories
   * and local git `forge/*` branches.
   *
   * This is a read-only diagnostic — it does not mutate registry or disk state.
   *
   * @param repoRoot — Absolute path to the repository root (defaults to two
   *   levels up from the storage path).
   */
  async reconcile(repoRoot?: string): Promise<ReconciliationReport> {
    const root = repoRoot ?? resolve(dirname(dirname(this.storagePath)));
    const worktreesDir = resolve(root, ".forge", "worktrees");

    // 1. Registry entries whose paths don't exist on disk.
    const staleRegistryEntries = this.getAll()
      .filter((handle) => !existsSync(handle.path))
      .map((handle) => handle.path);

    // 2. Directories in .forge/worktrees/ not tracked in the registry.
    const registryPaths = new Set(this.getAll().map((h) => h.path));
    let orphanedWorktrees: string[] = [];
    if (existsSync(worktreesDir)) {
      const entries = readdirSync(worktreesDir, { withFileTypes: true });
      orphanedWorktrees = entries
        .filter((d) => d.isDirectory())
        .map((d) => resolve(worktreesDir, d.name))
        .filter((p) => !registryPaths.has(p));
    }

    // 3. Local git forge/* branches not associated with any tracked worktree.
    let orphanedBranches: string[] = [];
    try {
      const { stdout } = await execFileAsync("git", ["branch", "--list", "forge/*"], {
        cwd: root,
      });
      const registeredBranches = new Set(
        this.getAll()
          .filter((h) => h.branch !== undefined)
          .map((h) => h.branch as string),
      );
      orphanedBranches = stdout
        .split("\n")
        .map((line) => line.replace(/^\*?\s+/, "").trim())
        .filter((b) => b.length > 0 && !registeredBranches.has(b));
    } catch {
      // Not a git repo or git unavailable — leave orphanedBranches empty.
    }

    return { staleRegistryEntries, orphanedWorktrees, orphanedBranches };
  }

  /**
   * Run {@link reconcile} and log a warning if any mismatches are found.
   *
   * @param repoRoot — Absolute path to the repository root (defaults to two
   *   levels up from the storage path).
   */
  async reconcileAndLog(repoRoot?: string): Promise<void> {
    const report = await this.reconcile(repoRoot);
    if (
      report.staleRegistryEntries.length > 0 ||
      report.orphanedWorktrees.length > 0 ||
      report.orphanedBranches.length > 0
    ) {
      logger.warn("[feature-forge] Worktree registry reconciliation found issues", {
        staleRegistryEntries: report.staleRegistryEntries,
        orphanedWorktrees: report.orphanedWorktrees,
        orphanedBranches: report.orphanedBranches,
      });
    }
  }

  /**
   * Write the current state to disk.
   */
  private async persist(): Promise<void> {
    const dir = dirname(this.storagePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    const data = Array.from(this.items.values()).map((handle) => handle.toJSON());
    await writeFile(this.storagePath, JSON.stringify(data, null, 2), "utf-8");
  }
}
