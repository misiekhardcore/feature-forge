import { mkdtempSync } from "node:fs";
import { join } from "node:path";

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
    if (!SharedStreamDir.instance) {
      SharedStreamDir.instance = mkdtempSync(join(baseDir, "agent-streams-"));
    }
    return SharedStreamDir.instance;
  }
}
