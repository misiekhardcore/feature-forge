import { WorkspaceError } from "./WorkspaceError";
import { WorkspaceHandle } from "./WorkspaceHandle";
import { WorkspaceProvider } from "./WorkspaceProvider";
import { WorktreeRegistry } from "./WorktreeRegistry";

/**
 * Composes a {@link WorkspaceProvider} with a {@link WorkspaceRegistry} into a
 * single high-level API for workspace lifecycle management.
 *
 * - **`create(id)`** — creates the workspace via the provider, then registers
 *   a new {@link WorkspaceHandle} so it's tracked and persisted.
 * - **`destroy(id)`** — looks up the handle, destroys via the provider, then
 *   removes the registry entry.
 * - **`get(id)` / `list()`** — delegate to the registry.
 *
 * Outside code never needs to touch the provider or registry directly —
 * they always go through the manager.
 */
export class WorkspaceManager {
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
    const handle = new WorkspaceHandle(workspaceId, path, new Date());
    await this.registry.register(handle);
    return handle;
  }

  /**
   * Destroy a workspace and remove its registry entry.
   *
   * Throws if the workspace id is not tracked.
   */
  async destroy(workspaceId: string): Promise<void> {
    const handle = this.registry.get(workspaceId);
    if (!handle) {
      throw new WorkspaceError(`No workspace found with id "${workspaceId}"`);
    }
    await this.provider.destroyWorkspace(handle.path);
    await this.registry.remove(workspaceId);
  }

  /**
   * Look up a workspace handle by id.
   */
  get(workspaceId: string): WorkspaceHandle | undefined {
    return this.registry.get(workspaceId);
  }

  /**
   * Return all tracked workspace handles.
   */
  list(): WorkspaceHandle[] {
    return [...this.registry.getAll()];
  }
}
