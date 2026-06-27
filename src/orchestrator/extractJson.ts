import type { ParsedResult } from "./FlowContext";

/**
 * Extract a JSON block from an agent's raw output.
 *
 * Looks for a ```json ... ``` fenced code block in the output.
 * Returns the parsed object if found and valid, or undefined.
 *
 * Used by {@link AgentStepExecutor} to extract structured findings
 * from agent responses when `parseJson: true` is configured on the
 * instruction.
 */
export function extractJson(raw: string): ParsedResult | undefined {
  const match = raw.match(/```json\s*\n([\s\S]*?)```/);
  if (!match || !match[1]) return undefined;

  try {
    const parsed = JSON.parse(match[1]);
    return parsed as ParsedResult;
  } catch {
    return undefined;
  }
}
