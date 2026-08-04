import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { minimatch } from "minimatch";

/**
 * Maps tool names to the input field that carries the value to check
 * against restriction patterns. Only tools listed here can be restricted;
 * calls to unlisted tools that appear in the restrictions map are blocked
 * with an "unknown input field" reason.
 */
const TOOL_INPUT_FIELDS: Record<string, string> = {
  bash: "command",
  write: "path",
  grep: "path",
  read: "path",
  edit: "path",
  find: "path",
  ls: "path",
};

/**
 * Activate per-tool pattern restriction for the current session.
 *
 * Registers a `tool_call` interceptor that blocks tool calls whose
 * input value does not match at least one of the per-tool glob
 * patterns. Tool calls for tools not listed in restrictions pass
 * through unchanged.
 *
 * Does nothing when `restrictions` is empty.
 *
 * `projectRoot` is the absolute directory that relative glob patterns
 * for path-based tools (write/edit/read/grep/find/ls) are resolved
 * against, so the patterns match the absolute path values those tools
 * receive. Bash command patterns are never resolved — they are matched
 * verbatim.
 */
export function activateToolRestrictions(
  pi: ExtensionAPI,
  restrictions: Record<string, readonly string[]>,
  projectRoot: string,
): void {
  // Only register the interceptor when there are actual restriction
  // patterns to enforce (non-empty arrays).
  const hasRestrictions = Object.values(restrictions).some((p) => p.length > 0);
  if (!hasRestrictions) return;

  pi.on("tool_call", (event) => {
    const patterns = restrictions[event.toolName];
    if (!patterns) return;

    // Empty patterns array means unrestricted — allow everything.
    if (patterns.length === 0) return;

    const inputField = TOOL_INPUT_FIELDS[event.toolName];
    if (!inputField) {
      return {
        block: true,
        reason: `tool "${event.toolName}" cannot be restricted — no input field mapping`,
      };
    }

    if (!event.input || typeof event.input !== "object" || !(inputField in event.input)) {
      return {
        block: true,
        reason: `${event.toolName} tool call missing "${inputField}" in input`,
      };
    }
    // `inputField` is validated to exist in `event.input` two lines above.
    const value = (event.input as Record<string, unknown>)[inputField];

    if (typeof value !== "string") {
      return {
        block: true,
        reason: `${event.toolName} tool call with non-string "${inputField}"`,
      };
    }

    // Path-based tools receive absolute paths, so resolve relative glob
    // patterns against the project root before matching. Bash command
    // patterns are matched verbatim.
    const isPathTool = inputField === "path";
    const resolvedPatterns = isPathTool
      ? patterns.map((p) => resolvePattern(p, projectRoot))
      : patterns;

    const allowed = isValueAllowed(value, resolvedPatterns);

    if (!allowed) {
      return {
        block: true,
        reason: `${event.toolName} "${inputField}" "${value}" does not match any allowed pattern`,
      };
    }
  });
}

/**
 * Resolve a relative glob pattern against the project root so it matches
 * the absolute path values path-based tools receive. Absolute patterns
 * (leading `/`) are returned unchanged; a leading `!` negation prefix is
 * preserved.
 */
function resolvePattern(pattern: string, projectRoot: string): string {
  const negated = pattern.startsWith("!");
  const core = negated ? pattern.slice(1) : pattern;
  if (core.startsWith("/")) return pattern;
  const resolved = projectRoot + "/" + core;
  return negated ? "!" + resolved : resolved;
}

/**
 * Check if a value is allowed against a list of glob patterns.
 *
 * Patterns are processed in order. Negation patterns (prefixed with `!`)
 * override positive matches — if a negation pattern matches, the value
 * is blocked even if a positive pattern also matched.
 */
function isValueAllowed(value: string, patterns: readonly string[]): boolean {
  let allowed = false;
  for (const pattern of patterns) {
    try {
      if (pattern.startsWith("!")) {
        if (minimatch(value, pattern.slice(1), { dot: true })) {
          return false;
        }
      } else {
        if (minimatch(value, pattern, { dot: true })) {
          allowed = true;
        }
      }
    } catch {
      // Safe: minimatch only throws on malformed patterns, which are benign
      // to ignore — the value simply will not match that pattern.
      console.warn("Failed to match pattern", { pattern, value });
    }
  }
  return allowed;
}
