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
   * @returns Absolute path to the created workspace.
   * @throws {WorkspaceError} subclass on failure (e.g., dirty working tree).
   */
  abstract createWorkspace(workspaceId: string): Promise<string>;

  /**
   * Tear down a previously created workspace.
   *
   * Safe to call multiple times — subsequent calls should be no-ops.
   *
   * @param path — The absolute path returned by {@link createWorkspace}.
   */
  abstract destroyWorkspace(path: string): Promise<void>;
}
