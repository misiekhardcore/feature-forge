/**
 * Typed error hierarchy for workspace/worktree operations.
 *
 * All errors extend {@link WorkspaceError} so callers can catch broadly
 * or inspect the specific subclass.
 */

export class WorkspaceError extends Error {
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = "WorkspaceError";
    this.cause = cause;
  }
}

/**
 * The main repository has uncommitted changes, making it unsafe to create
 * a clean worktree from HEAD.
 */
export class DirtyWorkingTreeError extends WorkspaceError {
  constructor(message?: string, cause?: Error) {
    super(message ?? "Working tree has uncommitted changes", cause);
    this.name = "DirtyWorkingTreeError";
  }
}

/**
 * The branch name required for this worktree already exists locally.
 */
export class WorktreeBranchExistsError extends WorkspaceError {
  constructor(branchName: string, cause?: Error) {
    super(`Branch already exists: ${branchName}`, cause);
    this.name = "WorktreeBranchExistsError";
  }
}

/**
 * The target directory for a new worktree already exists — likely a stale
 * worktree from a previous crashed session.
 */
export class WorktreePathExistsError extends WorkspaceError {
  constructor(path: string, cause?: Error) {
    super(`Worktree path already exists: ${path}`, cause);
    this.name = "WorktreePathExistsError";
  }
}
