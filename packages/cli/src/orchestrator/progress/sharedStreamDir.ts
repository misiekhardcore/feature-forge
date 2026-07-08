import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Session-persistent shared stream directory.
 *
 * Both {@link import("../RoutineTool").RoutineTool} (auto-open overlay
 * for routines) and {@link import("../../commands/AgentListCommand").AgentListCommand}
 * (manual `/agent:list`) use the same directory so stream files survive
 * overlay close/reopen cycles.
 */
export class SharedStreamDir {
  private static instance: string | undefined;

  static get(): string {
    if (!SharedStreamDir.instance) {
      SharedStreamDir.instance = mkdtempSync(join(tmpdir(), "forge-streams-"));
      process.once("exit", () => {
        try {
          rmSync(SharedStreamDir.instance!, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
      });
    }
    return SharedStreamDir.instance;
  }
}
