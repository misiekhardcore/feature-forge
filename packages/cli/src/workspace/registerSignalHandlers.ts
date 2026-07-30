import { logger } from "@feature-forge/shared";

import type { WorkspaceHandle } from "./WorkspaceHandle";
import type { WorkspaceManager } from "./WorkspaceManager";

/**
 * Best-effort cleanup of active workspaces on process termination.
 *
 * Runs all destroy operations concurrently with a 2-second timeout.
 * Exposed as a standalone function so callers can inject `exit` for
 * testing without mocking `process`.
 */
export function cleanupWorkspaces(
  workspaceManager: WorkspaceManager,
  signal: string,
  handles: WorkspaceHandle[],
  exit: (code: number) => void = process.exit.bind(process),
): void {
  if (handles.length === 0) {
    logger.info(`[feature-forge] Received ${signal}, no active workspaces to clean up`);
    exit(0);
    return;
  }

  logger.info(`[feature-forge] Received ${signal}, cleaning up ${handles.length} workspace(s)`);

  const destroyOps = handles.map(async (handle) => {
    try {
      await workspaceManager.destroy(handle.path);
      return "ok" as const;
    } catch (error) {
      logger.warn(`[feature-forge] Cleanup failed for workspace on ${signal}`, {
        path: handle.path,
        error,
      });
      return "failed" as const;
    }
  });

  const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 2000));

  void Promise.race([Promise.all(destroyOps), timeout])
    .then((result) => {
      if (result === "timeout") {
        logger.warn(`[feature-forge] Workspace cleanup timed out on ${signal}, forcing exit`);
        exit(1);
        return;
      }
      const failures = result.filter((r) => r === "failed").length;
      if (failures > 0) {
        logger.warn(`[feature-forge] ${failures}/${handles.length} cleanup(s) failed on ${signal}`);
        exit(1);
      } else {
        logger.info(`[feature-forge] Cleaned up ${handles.length} workspace(s) on ${signal}`);
        exit(0);
      }
    })
    .catch((error) => {
      logger.error(`[feature-forge] Unexpected error during ${signal} cleanup`, { error });
      exit(1);
    });
}

/**
 * Register SIGINT and SIGTERM handlers that perform best-effort
 * workspace cleanup before exiting.
 *
 * Uses {@link process.once} so handlers auto-remove after firing,
 * preventing listener leaks across extension reloads.
 */
export function registerSignalHandlers(workspaceManager: WorkspaceManager): void {
  process.once("SIGINT", () => {
    cleanupWorkspaces(workspaceManager, "SIGINT", workspaceManager.list());
  });
  process.once("SIGTERM", () => {
    cleanupWorkspaces(workspaceManager, "SIGTERM", workspaceManager.list());
  });
}
