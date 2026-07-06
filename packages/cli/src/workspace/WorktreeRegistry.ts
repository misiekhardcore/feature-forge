import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { Registry } from "@feature-forge/shared";

import { logger } from "../logging";
import { WorkspaceError } from "./WorkspaceError";
import { WorkspaceHandle } from "./WorkspaceHandle";

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
      const data = JSON.parse(raw) as { path: string; createdAt: string }[];

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
