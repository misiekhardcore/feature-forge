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
 * post-mortem debugging. Old directories are pruned against the configured
 * `logRetentionDays` window — never on overlay teardown.
 */
export class SharedStreamDir {
  private static instance: string | undefined;
  /** Whether the once-per-process sweep has already run. */
  private static _swept = false;

  static get(baseDir: string): string {
    this.sweepAndPrune(baseDir);
    if (!SharedStreamDir.instance) {
      mkdirSync(baseDir, { recursive: true });
      SharedStreamDir.instance = mkdtempSync(join(baseDir, "agent-streams-"));
    }
    return SharedStreamDir.instance;
  }

  /**
   * Prune `agent-streams-*` directories older than the configured retention
   * window. Retention-aware: directories within the window and the current
   * singleton are kept so stream history survives overlay close/reopen
   * cycles. No-op when `logRetentionDays` is `0` (retention disabled).
   */
  static cleanup(): void {
    const baseDir = ForgeConfig.getInstance().getLogDir();
    if (!existsSync(baseDir)) return;
    this.pruneByRetention(baseDir);
  }

  /**
   * Prune `agent-streams-*` directories under `baseDir` older than the
   * configured retention window. The current singleton and directories within
   * the window are kept so stream history survives overlay close/reopen
   * cycles. No-op when `logRetentionDays` is `0` (retention disabled).
   */
  private static pruneByRetention(baseDir: string): void {
    const retentionDays = ForgeConfig.getInstance().getLogRetentionDays();
    if (retentionDays <= 0) return;
    const cutoff = Date.now() - retentionDays * 86_400_000;
    for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("agent-streams-")) continue;
      const dirPath = join(baseDir, entry.name);
      if (dirPath === SharedStreamDir.instance) continue;
      if (statSync(dirPath).mtimeMs >= cutoff) continue;
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

  /**
   * Sweep stale `agent-streams-*` directories left by previous sessions:
   * remove empty ones and prune ones older than the configured retention
   * window. Runs at most once per process — get() calls the sweep only on
   * first use, so overlay open/reopen cycles do not rescan the log dir.
   */
  private static sweepAndPrune(baseDir: string): void {
    if (SharedStreamDir._swept) return;
    SharedStreamDir._swept = true;
    if (!existsSync(baseDir)) return;
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
      }
    }
    this.pruneByRetention(baseDir);
  }
}
