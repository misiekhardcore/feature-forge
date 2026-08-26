import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { logger } from "../logging";
import { Registry } from "../registry";
import { WorkspaceHandle } from "./WorkspaceHandle";
import {
  WorktreeRegistryCodec,
  type WorktreeRegistryEntry,
  type WorktreeRegistryFile,
} from "./WorktreeRegistryCodec";

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
 * Storage format: a versioned JSON envelope (`{version: 1, worktrees: [...]}`)
 * written to `<storagePath>` (e.g., `<repo-root>/.forge/worktrees.json`).
 * Encoding, decoding, and schema validation live in
 * {@link WorktreeRegistryCodec}; this class only handles file I/O and
 * in-memory state.
 *
 * Concurrency: `register()`/`remove()` serialize their read-modify-write
 * persist cycles through an in-process mutex (promise queue), and
 * `persist()` merges the in-memory state with the current file contents
 * (in-memory wins per path) before writing via a temp file + atomic
 * rename. Entries written by other pi sessions after our last load are
 * therefore preserved instead of clobbered.
 */
export class WorktreeRegistry extends Registry<WorkspaceHandle> {
  /**
   * Serializes persist cycles within this process so concurrent
   * register/remove calls cannot interleave their read-modify-write
   * cycles on the shared storage file.
   */
  private persistQueue: Promise<void> = Promise.resolve();

  /**
   * Paths this process has removed since its last {@link load}. The merge
   * in {@link persist} skips file entries in this set so a removal is not
   * resurrected by stale on-disk state.
   */
  private readonly removedPaths = new Set<string>();

  /** Supplies the current pi session id used to stamp new entries. */
  private sessionIdProvider?: () => string | undefined;

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
   *
   * When the handle has no `sessionId` and a session-id provider is set,
   * the stamp is applied before persistence. Handles are immutable, so a
   * new stamped handle is stored in the registry.
   *
   * @returns The handle actually stored — the session-stamped copy when
   *   the provider supplied a session id, otherwise the original.
   */
  async register(handle: WorkspaceHandle): Promise<WorkspaceHandle> {
    const stamped = this.stampSessionId(handle);
    this.set(stamped.path, stamped);
    // Re-registering a previously removed path clears its tombstone.
    this.removedPaths.delete(stamped.path);
    await this.persist();
    return stamped;
  }

  /**
   * Provide the current pi session id, used to stamp new registry entries.
   *
   * The provider is consulted only when a registered handle has no
   * `sessionId`; returning `undefined` leaves the entry unstamped (the id
   * is only observable inside a live pi session and can legitimately be
   * absent, e.g. before the first session hook fires).
   */
  setSessionIdProvider(provider: () => string | undefined): void {
    this.sessionIdProvider = provider;
  }

  /**
   * Return the handle with a session id stamped from the provider when it
   * has none.
   */
  private stampSessionId(handle: WorkspaceHandle): WorkspaceHandle {
    if (handle.sessionId !== undefined) {
      return handle;
    }
    const sessionId = this.sessionIdProvider?.();
    return sessionId === undefined
      ? handle
      : new WorkspaceHandle(handle.path, handle.createdAt, handle.branch, sessionId);
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
    this.removedPaths.add(path);
    await this.persist();
  }

  // ─── Persistence ─────────────────────────────────────────────────────

  /**
   * Load persisted data from disk.
   *
   * Must be called once before using the registry (typically at extension
   * startup). If the storage file doesn't exist yet, starts with an empty
   * registry. A missing, unreadable, corrupt, or schema-invalid file never
   * bricks the extension: it is logged as a warning and the registry
   * starts empty (ephemeral runtime state is self-healing).
   */
  async load(): Promise<void> {
    this.items.clear();
    this.removedPaths.clear();

    if (!existsSync(this.storagePath)) {
      return;
    }

    let raw: string;
    try {
      raw = await readFile(this.storagePath, "utf-8");
    } catch (cause) {
      logger.warn("Failed to read worktree registry file; starting with an empty registry", {
        path: this.storagePath,
        cause: cause instanceof Error ? cause.message : String(cause),
      });
      return;
    }

    let file: WorktreeRegistryFile;
    try {
      file = WorktreeRegistryCodec.parse(raw);
    } catch (cause) {
      logger.warn("Failed to parse worktree registry file; starting with an empty registry", {
        path: this.storagePath,
        cause: cause instanceof Error ? cause.message : String(cause),
      });
      return;
    }

    for (const entry of file.worktrees) {
      // Defensive: the schema allows duplicate paths; keep the first.
      if (!this.items.has(entry.path)) {
        this.set(entry.path, WorkspaceHandle.fromJSON(entry));
      }
    }
  }

  /**
   * Serialize the current in-memory state to disk.
   *
   * The persist cycles are serialized by an in-process mutex (promise
   * queue) so concurrent register/remove calls cannot interleave their
   * read-modify-write cycles. Each write merges the current file contents
   * with the in-memory state — in-memory wins per path — preserving
   * entries written by other processes since our last load. The write is
   * atomic: contents go to `<storagePath>.tmp-<pid>` first, then
   * `rename()` over the target, so readers never observe a torn file.
   */
  private persist(): Promise<void> {
    const run = this.persistQueue.then(() => this.persistNow());
    // A failed persist must not poison the queue for subsequent calls;
    // callers still observe the rejection via `run`.
    this.persistQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async persistNow(): Promise<void> {
    const dir = dirname(this.storagePath);
    await mkdir(dir, { recursive: true });

    const entries = await this.mergeWithDisk();

    const tmpPath = `${this.storagePath}.tmp-${process.pid}`;
    await writeFile(tmpPath, WorktreeRegistryCodec.serialize(entries), "utf-8");
    await rename(tmpPath, this.storagePath);
  }

  /**
   * Union of the on-disk file entries and the in-memory state, with the
   * in-memory state winning per path. File entries for paths this process
   * has removed since its last {@link load} are dropped (tombstoned). A
   * missing, unreadable, or corrupt file contributes nothing (the next
   * write self-heals it).
   */
  private async mergeWithDisk(): Promise<WorktreeRegistryEntry[]> {
    const merged = new Map<string, WorktreeRegistryEntry>();
    try {
      const raw = await readFile(this.storagePath, "utf-8");
      const file = WorktreeRegistryCodec.parse(raw);
      for (const entry of file.worktrees) {
        if (!this.removedPaths.has(entry.path)) {
          merged.set(entry.path, entry);
        }
      }
    } catch (cause) {
      // Missing, unreadable, or corrupt file — nothing to preserve.
      logger.debug(
        "Worktree registry file unreadable during merge; preserving in-memory state only",
        {
          path: this.storagePath,
          cause: cause instanceof Error ? cause.message : String(cause),
        },
      );
    }
    for (const handle of this.items.values()) {
      merged.set(handle.path, handle.toJSON());
    }
    return [...merged.values()];
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
      const registeredBranches = new Set(this.getAll().map((h) => h.branch));
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
}
