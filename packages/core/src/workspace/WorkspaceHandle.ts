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
    /** Branch name associated with this workspace. */
    public readonly branch: string,
    /** Optional pi session id that created this workspace. */
    public readonly sessionId?: string,
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
  toJSON(): { path: string; createdAt: string; branch: string; sessionId?: string } {
    return {
      path: this.path,
      createdAt: this.createdAt.toISOString(),
      branch: this.branch,
      ...(this.sessionId !== undefined ? { sessionId: this.sessionId } : {}),
    };
  }

  /**
   * Deserialize from a plain object (e.g., loaded from JSON storage).
   */
  static fromJSON(data: {
    path: string;
    createdAt: string;
    branch: string;
    sessionId?: string;
  }): WorkspaceHandle {
    if (typeof data.branch !== "string") {
      throw new TypeError(
        `WorkspaceHandle.fromJSON requires a non-empty branch (got ${typeof data.branch})`,
      );
    }
    if (data.branch.length === 0) {
      throw new TypeError(
        "WorkspaceHandle.fromJSON requires a non-empty branch (got an empty string)",
      );
    }
    const createdAt = new Date(data.createdAt);
    if (Number.isNaN(createdAt.getTime())) {
      throw new TypeError(
        `WorkspaceHandle.fromJSON requires a parseable createdAt (got ${data.createdAt})`,
      );
    }
    return new WorkspaceHandle(data.path, createdAt, data.branch, data.sessionId);
  }
}
