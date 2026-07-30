import { logger } from "@feature-forge/shared";

import type { WorkspaceManager } from "./WorkspaceManager";

/**
 * Best-effort cleanup of workspace paths on process termination.
 *
 * Runs all destroy operations concurrently with a 2-second timeout.
 * Exposed as a standalone function so callers can inject `exit` for
 * testing without mocking `process`.
 *
 * @param paths — paths to destroy. Only these paths are cleaned up,
 *   not all workspaces from the shared registry.
 */
export function cleanupWorkspaces(
  workspaceManager: WorkspaceManager,
  signal: string,
  paths: string[],
  exit: (code: number) => void = process.exit.bind(process),
): void {
  if (paths.length === 0) {
    logger.info(`[feature-forge] Received ${signal}, no session workspaces to clean up`);
    exit(0);
    return;
  }

  logger.info(`[feature-forge] Received ${signal}, cleaning up ${paths.length} workspace(s)`);

  const destroyOps = paths.map(async (path) => {
    try {
      await workspaceManager.destroy(path);
      return "ok" as const;
    } catch (error) {
      logger.warn(`[feature-forge] Cleanup failed for workspace on ${signal}`, {
        path,
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
        logger.warn(`[feature-forge] ${failures}/${paths.length} cleanup(s) failed on ${signal}`);
        exit(1);
      } else {
        logger.info(`[feature-forge] Cleaned up ${paths.length} workspace(s) on ${signal}`);
        exit(0);
      }
    })
    .catch((error: unknown) => {
      logger.error(`[feature-forge] Unexpected error during ${signal} cleanup`, { error });
      exit(1);
    });
}

/**
 * Register SIGINT and SIGTERM handlers that perform best-effort
 * workspace cleanup before exiting. Only workspaces tracked in
 * the session-scoped path set are destroyed.
 *
 * Uses {@link process.on} with explicit {@link process.removeListener}
 * after cleanup completes, so the next extension reload can re-register
 * without leaking listeners.
 *
 * @param workspaceManager — used to destroy session workspace paths.
 */
export function registerSignalHandlers(workspaceManager: WorkspaceManager): void {
  const sigintHandler = (): void => {
    const paths = workspaceManager.listSessionPaths();
    cleanupWorkspaces(workspaceManager, "SIGINT", paths, (code) => {
      process.removeListener("SIGINT", sigintHandler);
      process.removeListener("SIGTERM", sigtermHandler);
      process.exit(code);
    });
  };

  const sigtermHandler = (): void => {
    const paths = workspaceManager.listSessionPaths();
    cleanupWorkspaces(workspaceManager, "SIGTERM", paths, (code) => {
      process.removeListener("SIGINT", sigintHandler);
      process.removeListener("SIGTERM", sigtermHandler);
      process.exit(code);
    });
  };

  process.on("SIGINT", sigintHandler);
  process.on("SIGTERM", sigtermHandler);
}
