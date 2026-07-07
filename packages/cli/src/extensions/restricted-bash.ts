import type {
  ExtensionAPI,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

/**
 * Convert a glob-like allowlist pattern to a regex and test the command.
 *
 * Only `*` is supported as a wildcard (matches any sequence of characters).
 * Other special regex characters in the pattern are escaped.
 */
function commandMatchesPattern(command: string, pattern: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(command);
}

/**
 * Install a `tool_call` interceptor that blocks bash commands not matching
 * any pattern in the allowlist.
 *
 * When {@link patterns} is empty the function is a no-op. Non-bash tools
 * pass through untouched.
 *
 * @param pi - Extension API for the current session.
 * @param patterns - Glob-like command allowlist patterns
 *   (e.g. `["npm *", "git *"]`).
 */
export function activate(pi: ExtensionAPI, patterns: readonly string[]): void {
  if (patterns.length === 0) {
    return;
  }

  pi.on("tool_call", (event: ToolCallEvent) => {
    if (isToolCallEventType("bash", event)) {
      const command = event.input.command;
      const allowed = patterns.some((pattern) => commandMatchesPattern(command, pattern));
      if (!allowed) {
        const result: ToolCallEventResult = {
          block: true,
          reason: `Command "${command}" is not in the bash allowlist`,
        };
        return result;
      }
    }
    return undefined;
  });
}
