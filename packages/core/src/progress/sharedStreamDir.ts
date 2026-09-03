import {
  Dirent,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

import { logger } from "../logging";

/**
 * Session-persistent shared stream directory.
 *
 * Both RoutineTool (auto-open overlay
 * for routines) and AgentListCommand
 * (manual `/agent:list`) use the same directory so stream files survive
 * overlay close/reopen cycles.
 *
 * The directory is created under `baseDir` (typically `.forge/logs`) so
 * agent stream files persist alongside structured JSON Lines logs for
 * post-mortem debugging. Old directories are pruned against the `retentionDays`
 * window — never on overlay teardown. Both `baseDir` and `retentionDays` are
 * explicit parameters now: the log dir and retention come from the resolved
 * config at the call site, not from a singleton read inside this module.
 */
export class SharedStreamDir {
  private static instance: string | undefined;
  /** Whether the once-per-process sweep has already run. */
  private static _swept = false;

  static get(baseDir: string, retentionDays: number): string {
    this.sweepAndPrune(baseDir, retentionDays);
    if (!SharedStreamDir.instance) {
      mkdirSync(baseDir, { recursive: true });
      SharedStreamDir.instance = mkdtempSync(join(baseDir, "agent-streams-"));
    }
    return SharedStreamDir.instance;
  }

  /**
   * Prune `agent-streams-*` directories older than the retention window.
   * Retention-aware: directories within the window and the current
   * singleton are kept so stream history survives overlay close/reopen
   * cycles. No-op when `retentionDays` is `0` (retention disabled).
   */
  static cleanup(baseDir: string, retentionDays: number): void {
    if (!existsSync(baseDir)) return;
    this.pruneByRetention(baseDir, retentionDays);
  }

  /**
   * Prune `agent-streams-*` directories under `baseDir` older than the
   * retention window. The current singleton and directories within
   * the window are kept so stream history survives overlay close/reopen
   * cycles. No-op when `retentionDays` is `0` (retention disabled).
   */
  private static pruneByRetention(baseDir: string, retentionDays: number): void {
    if (retentionDays <= 0) return;
    const cutoff = Date.now() - retentionDays * 86_400_000;
    let pruned = 0;
    let entries: Dirent[];
    try {
      entries = readdirSync(baseDir, { withFileTypes: true });
    } catch (err) {
      logger.warn("Failed to list shared stream dirs during retention pruning", {
        dir: baseDir,
        error: String(err),
      });
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("agent-streams-")) continue;
      const dirPath = join(baseDir, entry.name);
      if (dirPath === SharedStreamDir.instance) continue;
      let stale: boolean;
      try {
        stale = statSync(dirPath).mtimeMs < cutoff;
      } catch (err) {
        logger.warn("Failed to stat shared stream dir during retention pruning", {
          dir: dirPath,
          error: String(err),
        });
        continue;
      }
      if (!stale) continue;
      try {
        rmSync(dirPath, { recursive: true, force: true });
        pruned++;
      } catch (err) {
        logger.warn("Failed to prune stale shared stream dir", {
          dir: dirPath,
          error: String(err),
        });
      }
    }
    if (pruned > 0) {
      logger.info("Pruned stale shared stream dirs", { count: pruned });
    }
  }

  /**
   * Sweep stale `agent-streams-*` directories left by previous sessions:
   * remove empty ones and prune ones older than the retention
   * window. Runs at most once per process — get() calls the sweep only on
   * first use, so overlay open/reopen cycles do not rescan the log dir.
   */
  private static sweepAndPrune(baseDir: string, retentionDays: number): void {
    if (SharedStreamDir._swept) return;
    SharedStreamDir._swept = true;
    if (!existsSync(baseDir)) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(baseDir, { withFileTypes: true });
    } catch (err) {
      logger.warn("Failed to list shared stream dirs during sweep", {
        dir: baseDir,
        error: String(err),
      });
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("agent-streams-")) continue;
      const dirPath = join(baseDir, entry.name);
      if (dirPath === SharedStreamDir.instance) continue;
      let isEmpty: boolean;
      try {
        isEmpty = readdirSync(dirPath).length === 0;
      } catch (err) {
        logger.warn("Failed to read shared stream dir during sweep", {
          dir: dirPath,
          error: String(err),
        });
        continue;
      }
      if (isEmpty) {
        try {
          rmdirSync(dirPath);
        } catch (err) {
          logger.warn("Failed to remove empty shared stream dir", {
            dir: dirPath,
            error: String(err),
          });
        }
      }
    }
    this.pruneByRetention(baseDir, retentionDays);
  }
}
