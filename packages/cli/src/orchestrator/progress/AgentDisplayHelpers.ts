import type { AgentMessage } from "@earendil-works/pi-agent-core";
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
   * Extract text content from an {@link AgentMessage}.
   *
   * Only roles with text-bearing content fields (user, toolResult, assistant)
   * produce output. Other roles return an empty string.
   */
  static extractMessageText(message: AgentMessage): string {
    if ("content" in message) {
      const content = message.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        const parts: string[] = [];
        for (const block of content) {
          if (
            typeof block === "object" &&
            block !== null &&
            "type" in block &&
            "text" in block &&
            block.type === "text" &&
            typeof block.text === "string"
          ) {
            parts.push(block.text);
          }
        }
        return parts.join(" ");
      }
    }
    return "";
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
}
