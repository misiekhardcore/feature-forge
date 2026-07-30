/**
 * Session-scoped workspace path tracking.
 *
 * The {@link WorktreeRegistry} is a process-level singleton shared across
 * all pi sessions. This module provides per-session tracking so signal
 * handlers only destroy workspaces belonging to the current session.
 *
 * Use {@link addSessionWorkspace} when creating a workspace,
 * {@link removeSessionWorkspace} when destroying one, and
 * {@link getSessionWorkspacePaths} when registering signal handlers.
 */
const sessionWorkspacePaths = new Set<string>();

/** Add a workspace path to the current session's tracked set. */
export function addSessionWorkspace(path: string): void {
  sessionWorkspacePaths.add(path);
}

/** Remove a workspace path from the current session's tracked set. */
export function removeSessionWorkspace(path: string): void {
  sessionWorkspacePaths.delete(path);
}

/** Return all workspace paths currently tracked for this session. */
export function getSessionWorkspacePaths(): string[] {
  return [...sessionWorkspacePaths];
}

/** Clear all tracked workspace paths (used after signal cleanup). */
export function clearSessionWorkspaces(): void {
  sessionWorkspacePaths.clear();
}
