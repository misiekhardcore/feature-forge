/**
 * Value object representing a handle to an active worktree/workspace.
 *
 * Created when a workspace is allocated and stored in the
 * {@link WorktreeRegistry} for the duration of the task.
 */
export class WorkspaceHandle {
  constructor(
    /** Unique identifier for this workspace (typically the task id). */
    public readonly id: string,
    /** Absolute path to the workspace directory. */
    public readonly path: string,
    /** Timestamp when the workspace was created. */
    public readonly createdAt: Date,
  ) {}

  /**
   * Compare two handles for equality by id and path.
   */
  equals(other: WorkspaceHandle): boolean {
    return this.id === other.id && this.path === other.path;
  }

  /**
   * Serialize to a plain object for JSON persistence.
   */
  toJSON(): { id: string; path: string; createdAt: string } {
    return {
      id: this.id,
      path: this.path,
      createdAt: this.createdAt.toISOString(),
    };
  }

  /**
   * Deserialize from a plain object (e.g., loaded from JSON storage).
   */
  static fromJSON(data: { id: string; path: string; createdAt: string }): WorkspaceHandle {
    return new WorkspaceHandle(data.id, data.path, new Date(data.createdAt));
  }
}
