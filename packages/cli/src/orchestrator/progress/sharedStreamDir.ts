import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

import { ForgeConfig, logger } from "@feature-forge/shared";

/**
 * Session-persistent shared stream directory.
 *
 * Both {@link import("../RoutineTool").RoutineTool} (auto-open overlay
 * for routines) and {@link import("../../commands/AgentListCommand").AgentListCommand}
 * (manual `/agent:list`) use the same directory so stream files survive
 * overlay close/reopen cycles.
 *
 * The directory is created under `baseDir` (typically `.forge/logs`) so
 * agent stream files persist alongside structured JSON Lines logs for
 * post-mortem debugging.
 */
export class SharedStreamDir {
  private static instance: string | undefined;

  static get(baseDir: string): string {
    this.sweepAndPrune(baseDir);
    if (!SharedStreamDir.instance) {
      mkdirSync(baseDir, { recursive: true });
      SharedStreamDir.instance = mkdtempSync(join(baseDir, "agent-streams-"));
    }
    return SharedStreamDir.instance;
  }

  /**
   * Remove the session-persistent stream directory if one was created.
   *
   * Called from {@link import("../RoutineTool").RoutineTool} and
   * {@link import("../../commands/AgentListCommand").AgentListCommand}
   * teardown paths so stream files do not accumulate across sessions.
   */
  static cleanup(): void {
    if (SharedStreamDir.instance) {
      try {
        rmSync(SharedStreamDir.instance, { recursive: true, force: true });
      } catch (err) {
        logger.warn("Failed to clean up shared stream dir", {
          dir: SharedStreamDir.instance,
          error: String(err),
        });
      }
      SharedStreamDir.instance = undefined;
    }
  }

  /**
   * Sweep stale `agent-streams-*` directories left by previous sessions:
   * remove empty ones and prune ones older than the configured retention
   * window. The current singleton directory is always skipped.
   */
  private static sweepAndPrune(baseDir: string): void {
    if (!existsSync(baseDir)) return;
    const retentionDays = ForgeConfig.getInstance().getLogRetentionDays();
    const cutoff = Date.now() - retentionDays * 86_400_000;
    for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("agent-streams-")) continue;
      const dirPath = join(baseDir, entry.name);
      if (dirPath === SharedStreamDir.instance) continue;
      if (readdirSync(dirPath).length === 0) {
        try {
          rmdirSync(dirPath);
        } catch (err) {
          logger.warn("Failed to remove empty shared stream dir", {
            dir: dirPath,
            error: String(err),
          });
        }
        continue;
      }
      if (retentionDays > 0 && statSync(dirPath).mtimeMs < cutoff) {
        try {
          rmSync(dirPath, { recursive: true, force: true });
        } catch (err) {
          logger.warn("Failed to prune stale shared stream dir", {
            dir: dirPath,
            error: String(err),
          });
        }
      }
    }
  }
}
