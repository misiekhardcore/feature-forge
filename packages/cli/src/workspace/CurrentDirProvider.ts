import type { CreateWorkspaceOptions } from "./WorkspaceProvider";
import { WorkspaceProvider } from "./WorkspaceProvider";

/**
 * Concrete {@link WorkspaceProvider} that returns `process.cwd()` — a no-op.
 *
 * Creates no new directory and performs no cleanup. Used for read-only
 * agents that inspect the build worktree without needing isolation.
 */
export class CurrentDirProvider extends WorkspaceProvider {
  public override async createWorkspace(
    _workspaceId: string,
    _options?: CreateWorkspaceOptions,
  ): Promise<string> {
    return process.cwd();
  }

  public override async destroyWorkspace(_path: string): Promise<void> {
    // No-op: current directory is not owned by any single task.
  }
}
