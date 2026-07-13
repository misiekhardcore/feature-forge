import type { ThemeColor } from "@earendil-works/pi-coding-agent";

/**
 * Display helpers for agent viewer rendering.
 *
 * Provides static utilities for extracting message text, resolving status
 * icons, serializing tool arguments, and safely navigating nested objects.
 * All methods are pure — no instance state, no side effects.
 */
export class AgentDisplayHelpers {
  /**
 * Extract concatenated text from a message object's content blocks.
 *
 * Handles both arrays of {@code { type: "text", text: "..." }} blocks
 * and plain string content.
 */
  static extractMessageText(message: unknown): string {
  if (typeof message === "string") return message;
  if (typeof message !== "object" || message === null) return "";
  const msg = message as Record<string, unknown>;
  const content = msg["content"];
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "object" && block !== null) {
      const b = block as Record<string, unknown>;
      if (b["type"] === "text" && typeof b["text"] === "string") {
        parts.push(b["text"]);
      }
    }
  }
  return parts.join(" ");
  }

/**
 * Resolve a status string to an icon character and theme colour tuple.
 *
 * - `"done"` + `passed !== false` → `{ char: "✓", color: "success" }`
 * - `"done"` + `passed === false` → `{ char: "✗", color: "error" }`
 * - `"running"` → `{ char: "⟳", color: "accent" }`
 * - `"started"` → `{ char: "⏳", color: "warning" }`
 * - `"error"` → `{ char: "✗", color: "error" }`
 * - anything else → `{ char: "○", color: "muted" }`
 */
  static getStatusIcon(
  status: string | undefined,
  passed?: boolean,
  ): { char: string; color: ThemeColor } {
  switch (status) {
    case "done":
      return passed === false ? { char: "✗", color: "error" } : { char: "✓", color: "success" };
    case "running":
      return { char: "⟳", color: "accent" };
    case "started":
      return { char: "⏳", color: "warning" };
    case "error":
      return { char: "✗", color: "error" };
    default:
      return { char: "○", color: "muted" };
  }
  }

/**
 * Serialize tool call arguments to a stable string representation.
 *
 * Attempts JSON serialization first; falls back to {@code String()} for
 * non-serializable values (BigInt, circular references, etc.).
 */
  static serializeToolArgs(args: unknown): string {
  if (typeof args === "string") return args;
  try {
    const serialized = JSON.stringify(args, null, 2);
    if (serialized !== undefined) return serialized;
  } catch {
    // Fall through to string coercion.
  }
  return String(args);
  }

/**
 * Walk a dotted key path into a nested object and return a string value,
 * or {@code ""} when any intermediate key is missing.
 */
  static getNestedString(root: unknown, ...keys: string[]): string {
  let current: unknown = root;
  for (const key of keys) {
    if (typeof current !== "object" || current === null) return "";
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : "";
  }
  }
