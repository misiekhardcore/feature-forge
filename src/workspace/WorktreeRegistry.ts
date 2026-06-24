import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { Registry } from "../registry";
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
    this.set(handle.id, handle);
    await this.persist();
  }

  /**
   * Remove a workspace handle by id and persist the change.
   * Safe to call for non-existent ids — becomes a no-op.
   */
  async remove(id: string): Promise<void> {
    if (!this.has(id)) {
      return;
    }
    this.unregister(id);
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
      const data: { id: string; path: string; createdAt: string }[] = JSON.parse(raw);

      for (const entry of data) {
        const handle = WorkspaceHandle.fromJSON(entry);
        this.set(handle.id, handle);
      }
    } catch (cause) {
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
