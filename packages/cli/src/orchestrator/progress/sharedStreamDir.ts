import { mkdtempSync } from "node:fs";
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
let sharedStreamDir: string | undefined;

export function getSharedStreamDir(): string {
  if (!sharedStreamDir) {
    sharedStreamDir = mkdtempSync(join(tmpdir(), "forge-streams-"));
  }
  return sharedStreamDir;
}
