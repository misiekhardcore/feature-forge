/**
 * Options passed to {@link WorkspaceProvider.createWorkspace}.
 */
export interface CreateWorkspaceOptions {
  /**
   * Additional symlink paths (relative to repo root) to create inside
   * the workspace after provisioning.
   */
  symlinks?: readonly string[];
  /**
   * Existing branch name to reuse. Mutually exclusive with {@link baseRef}.
   * If the branch exists, the provider checks it out. If it does not exist,
   * a new branch is created from the provider's default baseRef.
   */
  branch?: string;
  /**
   * Git ref to create the worktree from. Mutually exclusive with {@link branch}.
   * Overrides the provider's default baseRef when set. Use this to create
   * a fresh worktree from a specific commit (e.g. "origin/HEAD").
   */
  baseRef?: string;
}

/**
 * Abstract workspace provider that creates and destroys isolated working
 * directories for agents.
 *
 * Concrete implementations:
 * - {@link GitWorktreeProvider} — creates a git worktree
 *   `git worktree`), suitable for build agents that need to branch and commit.
 * - {@link CurrentDirProvider} — returns `process.cwd()` as a no-op workspace,
 *   suitable for read-only agents that inspect the build worktree.
 */
export abstract class WorkspaceProvider {
  /**
   * Create an isolated working directory for an agent.
   *
   * @param workspaceId — Unique identifier for the workspace (typically the task id).
   * @param options — Optional configuration (e.g., symlinks to create).
   * @returns Absolute path to the created workspace.
   * @throws {WorkspaceError} subclass on failure (e.g., dirty working tree).
   */
  abstract createWorkspace(workspaceId: string, options?: CreateWorkspaceOptions): Promise<string>;

  /**
   * Tear down a previously created workspace.
   *
   * Safe to call multiple times — subsequent calls should be no-ops.
   *
   * @param path — The absolute path returned by {@link createWorkspace}.
   */
  abstract destroyWorkspace(path: string): Promise<void>;
}
