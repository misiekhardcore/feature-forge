# Plan: Workspace/Branch Cleanup Reliability (#171)

## Phase 1: Stop the bleeding

### Subtask 1 — Branch deletion in destroyWorkspace

- [ ] Change `WorkspaceProvider.destroyWorkspace` signature to accept optional `branch?: string`
- [ ] Update `GitWorktreeProvider.destroyWorkspace` — call `git branch -D <branch>` after worktree removal (best-effort, non-fatal)
- [ ] Update `CurrentDirProvider.destroyWorkspace` — ignore branch (no-op)
- [ ] Update `MockWorkspaceProvider` in test-utils — add optional branch param
- [ ] Update `WorkspaceManager.destroy` to pass `handle.branch`
- [ ] Update `CleanupStepExecutor.destroyPath` — pass `undefined` (no branch context at cleanup step level)
- [ ] Update all test providers (RoutineTool.test.ts, WorkspaceStepExecutor.test.ts, CleanupStepExecutor.test.ts, WorkspaceProviderRegistry.test.ts)
- [ ] Add tests: branch deletion success, branch deletion failure (non-fatal), missing branch (no-op)

### Subtask 2 — FlowExitCommand cleanup

- [ ] Inject `WorkspaceManager` into `FlowExitCommand` constructor
- [ ] In handler: iterate `workspaceManager.list()`, call `workspaceManager.destroy()` for each before unmounting agents
- [ ] Update `index.ts` to pass `workspaceManager` to `FlowExitCommand`
- [ ] Update `Command` base class if needed
- [ ] Add tests: destroys workspaces on exit, survives destroy failure, empty list is no-op

## Phase 2: Reliability

### Subtask 3 — Startup reconciliation

- [ ] Add `reconcile()` method to `WorktreeRegistry`
- [ ] Reads `.forge/worktrees/` dirs on disk, lists local `forge/*` git branches
- [ ] Returns structured report: `{ staleRegistryEntries, orphanedWorktrees, orphanedBranches }`
- [ ] Logs mismatches
- [ ] Call `reconcile()` after `load()` in `index.ts`
- [ ] Add tests for reconcile

### Subtask 4 — Process signal handlers

- [ ] Register `SIGINT`/`SIGTERM` handlers in `index.ts`
- [ ] Best-effort destroyWorkspace on all workspaces in `workspaceManager.list()`
- [ ] Log errors, don't prevent process exit

### Subtask 5 — `/worktree:prune` command

- [ ] Create `WorktreePruneCommand.ts`
- [ ] Without `--sweep`: list stale worktrees/branches/registry entries (read-only)
- [ ] With `--sweep`: confirm then remove stale items
- [ ] Register in `index.ts`
- [ ] Add tests
