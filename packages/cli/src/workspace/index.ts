export { CurrentDirProvider } from "./CurrentDirProvider";
export { GitWorktreeProvider } from "./GitWorktreeProvider";
export {
  addSessionWorkspace,
  clearSessionWorkspaces,
  getSessionWorkspacePaths,
  removeSessionWorkspace,
} from "./sessionWorkspaces";
export {
  DirtyWorkingTreeError,
  WorkspaceError,
  WorktreeBranchExistsError,
  WorktreePathExistsError,
} from "./WorkspaceError";
export { WorkspaceHandle } from "./WorkspaceHandle";
export { WorkspaceManager } from "./WorkspaceManager";
export { CreateWorkspaceOptions, WorkspaceProvider } from "./WorkspaceProvider";
export { WorkspaceProviderRegistry } from "./WorkspaceProviderRegistry";
export { WorktreeRegistry } from "./WorktreeRegistry";
