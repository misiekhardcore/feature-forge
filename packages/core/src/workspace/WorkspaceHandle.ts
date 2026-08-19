/**
 * Value object representing a handle to an active worktree/workspace.
 *
 * Created when a workspace is allocated and stored in the
 * {@link WorktreeRegistry} for the duration of the task.
 */
export class WorkspaceHandle {
  constructor(
    /** Absolute path to the workspace directory. (unique) */
    public readonly path: string,
    /** Timestamp when the workspace was created. */
    public readonly createdAt: Date,
    /** Optional branch name associated with this workspace. */
    public readonly branch?: string,
  ) {}

  /**
   * Compare two handles for equality by path.
   */
  equals(other: WorkspaceHandle): boolean {
    return this.path === other.path;
  }

  /**
   * Serialize to a plain object for JSON persistence.
   */
  toJSON(): { path: string; createdAt: string; branch?: string } {
    return {
      path: this.path,
      createdAt: this.createdAt.toISOString(),
      ...(this.branch !== undefined ? { branch: this.branch } : {}),
    };
  }

  /**
   * Deserialize from a plain object (e.g., loaded from JSON storage).
   */
  static fromJSON(data: { path: string; createdAt: string; branch?: string }): WorkspaceHandle {
    return new WorkspaceHandle(data.path, new Date(data.createdAt), data.branch);
  }
}
