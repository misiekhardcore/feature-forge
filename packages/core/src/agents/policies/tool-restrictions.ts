import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { minimatch } from "minimatch";

import { logger } from "../../logging";

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
 * Glob-to-regex matcher for bash commands where `*` matches any
 * characters including `/` (unlike minimatch, where `*` excludes `/`).
 *
 * Minimatch is a file-path globber — it treats `/` as a path separator
 * that `*` must not cross. That makes it the wrong tool for matching
 * arbitrary bash commands like `gh api repos/owner/repo/pulls` where
 * slashes appear in URL paths, package names, or file arguments.
 *
 * This matcher does a simple glob→regex conversion: each `*` becomes
 * `.*` (greedy, matches `/`). It does not support `?`, `[]`, `{}`,
 * `**`, or other extended glob syntax — bash command patterns in
 * practice only use `*` as a catch-all suffix.
 */
function bashGlobMatch(value: string, pattern: string): boolean {
  // Escape regex special characters except `*`
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  // `*` matches any sequence of characters (including `/`)
  const regex = new RegExp("^" + escaped.replace(/\*/g, ".*") + "$");
  return regex.test(value);
}

/**
 * Split a bash command into segments on chain/pipe operators.
 *
 * Chained commands like `cd /proj && gh pr view | cat` don't match
 * a single prefix pattern because each segment starts with a different
 * command. This splits on `&&`, `||`, `;`, and `|` (with surrounding
 * whitespace), then checks that every segment is covered by the
 * allowlist. Pipes inside quoted strings (e.g. `echo "a|b"`) are
 * preserved because there is no whitespace around them.
 *
 * This is a heuristic, not a shell parser — same-class bypass surface as
 * the unspaced pipe: command substitution (`gh pr view $(cat secret)`) is
 * never split into segments, so the nested command is checked only as part
 * of the whole string and can pass a `gh *` allowlist. Allowlist authors
 * must account for both (quote-aware parsing is a deliberate follow-up).
 */
function splitCommand(command: string): string[] {
  return command
    .split(/\s*(?:&&|\|\||;)\s*|\s+\|\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Check a chained bash command against the allowlist patterns.
 *
 * Every segment (split by `&&`, `||`, `;`, `|`) must match at least
 * one positive pattern and no negation pattern. This way
 * `cd /proj && gh pr view` passes when both `bash:cd *` and
 * `bash:gh *` are in the allowlist.
 */
function isBashCommandAllowed(command: string, patterns: readonly string[]): boolean {
  const segments = splitCommand(command);

  // Separate negation and positive patterns once
  const negations: string[] = [];
  const positives: string[] = [];
  for (const p of patterns) {
    if (p.startsWith("!")) {
      negations.push(p.slice(1));
    } else {
      positives.push(p);
    }
  }

  // Every segment must pass: at least one positive match, no negation match
  return segments.every((segment) => {
    if (negations.some((n) => bashGlobMatch(segment, n))) return false;
    return positives.some((p) => bashGlobMatch(segment, p));
  });
}

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
    // patterns are matched with a `/`-permissive glob matcher instead of
    // minimatch, which treats `/` as a path separator and would block
    // commands like `gh api repos/owner/repo`.
    const isPathTool = inputField === "path";
    const isBashTool = event.toolName === "bash";
    const resolvedPatterns = isPathTool
      ? patterns.map((p) => resolvePattern(p, projectRoot))
      : patterns;

    const allowed = isBashTool
      ? isBashCommandAllowed(value, resolvedPatterns)
      : isValueAllowed(value, resolvedPatterns, minimatchMatch);

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

/** Match a value with minimatch (for path-based tools). */
function minimatchMatch(value: string, pattern: string): boolean {
  return minimatch(value, pattern, { dot: true });
}

/**
 * Check if a value is allowed against a list of glob patterns.
 *
 * Patterns are processed in order. Negation patterns (prefixed with `!`)
 * override positive matches — if a negation pattern matches, the value
 * is blocked even if a positive pattern also matched.
 *
 * The `match` function controls how a single pattern is tested against
 * the value. Path tools use minimatch (file-path glob, `*` excludes `/`);
 * bash commands use {@link bashGlobMatch} (simple glob, `*` includes `/`).
 */
function isValueAllowed(
  value: string,
  patterns: readonly string[],
  match: (value: string, pattern: string) => boolean,
): boolean {
  let allowed = false;
  for (const pattern of patterns) {
    try {
      if (pattern.startsWith("!")) {
        if (match(value, pattern.slice(1))) {
          return false;
        }
      } else {
        if (match(value, pattern)) {
          allowed = true;
        }
      }
    } catch {
      // Safe: malformed patterns are benign to ignore — the value simply
      // will not match that pattern.
      logger.warn("Failed to match pattern", { pattern, value });
    }
  }
  return allowed;
}
