import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message, TextContent } from "@earendil-works/pi-ai";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";

/**
 * Extract text content from an {@link AgentMessage}.
 *
 * Only roles with text-bearing content fields (user, toolResult, assistant)
 * produce output. Other roles return an empty string.
 */
export function extractMessageText(message: AgentMessage): string {
  if ("content" in message) {
    return extractContentText(message.content);
  }
  return "";
}

/**
 * Extracts text content from various content formats used in messages and tool results.
 */
export function extractContentText(content: Message["content"]): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content
      .filter((part) => isTextPart(part))
      .map((part) => part.text)
      .join("\n");
    if (text) return text;
  }
  return "";
}

/**
 * Type guard to verify if a part is a text block.
 */
export function isTextPart(part: Message["content"][number]): part is TextContent {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    part.type === "text" &&
    "text" in part &&
    typeof part.text === "string"
  );
}

export function getHorizontalLine(width: number) {
  return "─".repeat(width);
}

export function getStatusLabel(
  status: string | undefined,
  passed?: boolean,
): { label: string; color: ThemeColor } {
  switch (status) {
    case "started":
      return { label: "running", color: "accent" };
    case "done":
      return passed === false
        ? { label: "failed", color: "error" }
        : { label: "completed", color: "success" };
    case "error":
      return { label: "error", color: "error" };
    default:
      return { label: status ?? "unknown", color: "muted" };
  }
}

/**
 * Resolve a status string to an icon character and theme colour tuple.
 *
 * - `"done"` + `passed !== false` → `{ char: "✓", color: "success" }`
 * - `"done"` + `passed === false` → `{ char: "✗", color: "error" }`
 * - `"running"` → `{ char: "⟳", color: "accent" }`
 * - `"started"` → `{ char: "⟳", color: "accent" }`
 * - `"error"` → `{ char: "✗", color: "error" }`
 * - anything else → `{ char: "○", color: "muted" }`
 */
export function getStatusIcon(
  status: string | undefined,
  passed?: boolean,
): { char: string; color: ThemeColor } {
  switch (status) {
    case "done":
      return passed === false ? { char: "✗", color: "error" } : { char: "✓", color: "success" };
    case "started":
    case "running":
      return { char: "⟳", color: "accent" };
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
export function serializeToolArgs(args: unknown): string {
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
 * Extract human-readable text from a tool execution result or update payload.
 *
 * The runtime type is {@code AgentToolResult} which carries {@code content}
 * as an array of {@code { type: "text", text: string }} blocks.
 * This method extracts text from those blocks, falling back to
 * JSON serialization for non-text content and returning empty string
 * for null/undefined.
 */
export function serializeToolResultText(result: unknown): string {
  if (result === null || result === undefined) {
    return "";
  }
  if (typeof result === "string") {
    return result;
  }
  // Handle AgentToolResult shape: { content: [{ type: "text", text: "..." }], details: ... }
  const obj = result as Record<string, unknown>;
  if (typeof obj === "object" && "content" in obj && Array.isArray(obj.content)) {
    const parts: string[] = [];
    for (const block of obj.content) {
      if (
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        (block as Record<string, unknown>).type === "text" &&
        "text" in block &&
        typeof (block as { text: unknown }).text === "string"
      ) {
        parts.push((block as { text: string }).text);
      }
    }
    if (parts.length > 0) {
      return parts.join("\n");
    }
  }
  // Fall back to JSON serialization.
  try {
    const serialized = JSON.stringify(result, null, 2);
    if (serialized !== undefined) return serialized;
  } catch {
    // Fall through to string coercion.
  }
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- typed `unknown`, fallback only; String() is the safe last resort
  return String(result);
}

// Re-export as class for backward compatibility.
export class AgentDisplayHelpers {
  static extractMessageText = extractMessageText;
  static extractContetText = extractContentText;
  static isTextPart = isTextPart;
  static getHorizontalLine = getHorizontalLine;
  static getStatusLabel = getStatusLabel;
  static getStatusIcon = getStatusIcon;
  static serializeToolArgs = serializeToolArgs;
  static serializeToolResultText = serializeToolResultText;
}
