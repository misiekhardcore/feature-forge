import { WorkspaceHandle } from "@feature-forge/core/src/workspace/WorkspaceHandle";

import { WorkspaceError } from "./WorkspaceError";
import { WorkspaceProvider } from "./WorkspaceProvider";
import { WorktreeRegistry } from "./WorktreeRegistry";

/**
 * Composes a {@link WorkspaceProvider} with a {@link WorkspaceRegistry} into a
 * single high-level API for workspace lifecycle management.
 *
 * - **`create(id)`** — creates the workspace via the provider, then registers
 *   a new {@link WorkspaceHandle} so it's tracked and persisted.
 * - **`destroy(path)`** — looks up the handle, destroys via the provider, then
 *   removes the registry entry and untracks from the session set.
 * - **`get(path)` / `list()`** — delegate to the registry.
 *
 * Note: `destroy`/`get` are keyed by workspace **path**, not by workspace id
 * (the underlying {@link WorktreeRegistry} keys by `handle.path`).
 *
 * Also maintains a session-scoped path set ({@link listSessionPaths})
 * so signal handlers only destroy workspaces belonging to this process,
 * not workspaces loaded from the shared file-backed registry that were
 * created by other processes.
 */
export class WorkspaceManager {
  /** Paths created during this process's lifetime. Scoped for signal cleanup. */
  private readonly sessionPaths = new Set<string>();

  constructor(
    private readonly provider: WorkspaceProvider,
    private readonly registry: WorktreeRegistry,
  ) {}

  /**
   * Create an isolated workspace, register it, and persist the record.
   *
   * @returns The handle for the newly created workspace.
   */
  async create(workspaceId: string): Promise<WorkspaceHandle> {
    const path = await this.provider.createWorkspace(workspaceId);
    const handle = new WorkspaceHandle(path, new Date());
    await this.registry.register(handle);
    this.sessionPaths.add(path);
    return handle;
  }

  /**
   * Destroy a workspace, remove its registry entry, and untrack
   * from the session set.
   *
   * Throws if the path is not tracked.
   */
  async destroy(path: string): Promise<void> {
    const handle = this.registry.get(path);
    if (!handle) {
      throw new WorkspaceError(`No workspace found at path "${path}"`);
    }
    await this.provider.destroyWorkspace(handle.path, handle.branch);
    await this.registry.remove(path);
    this.sessionPaths.delete(path);
  }

  /**
   * Track a path in the current session set.
   *
   * Callers that create workspaces without going through {@link create}
   * (e.g. {@link WorkspaceStepExecutor}) must call this to ensure the
   * path is scoped for signal-handler cleanup.
   */
  trackPath(path: string): void {
    this.sessionPaths.add(path);
  }

  /**
   * Remove a path from the current session set.
   *
   * {@link destroy} calls this automatically. Callers that destroy
   * workspaces outside the manager (e.g. {@link CleanupStepExecutor})
   * should call this explicitly after a successful destroy.
   */
  untrackPath(path: string): void {
    this.sessionPaths.delete(path);
  }

  /**
   * Return workspace paths created during this process's lifetime.
   *
   * Unlike {@link list} (which returns all entries from the shared
   * file-backed registry), this only returns paths explicitly tracked
   * via {@link trackPath} or {@link create}. Signal handlers use this
   * to avoid destroying workspaces belonging to other processes.
   */
  listSessionPaths(): string[] {
    return [...this.sessionPaths];
  }

  /**
   * Look up a workspace handle by path.
   */
  get(path: string): WorkspaceHandle | undefined {
    return this.registry.get(path);
  }

  /**
   * Return all tracked workspace handles from the shared registry.
   */
  list(): WorkspaceHandle[] {
    return [...this.registry.getAll()];
  }
}
