import type { AgentOutput } from "../FlowContext";

/**
 * Extract a JSON block from an agent's raw output.
 *
 * Looks for a ```json ... ``` fenced code block in the output.
 * Returns the parsed object if found and valid, or undefined.
 *
 * Used by {@link AgentStepExecutor} to extract structured results
 * from agent responses when `parseJson: true` is configured on the
 * instruction.
 *
 * Only `passed` (boolean) and `summary` (string) are required.
 * All other fields pass through opaquely in `details`.
 */
export function extractJson(raw: string): AgentOutput | undefined {
  const match = raw.match(/```json\s*\n([\s\S]*?)```/);
  if (!match || !match[1]) {
    // Fall back: look for a bare { … } block.
    const braceMatch = raw.match(/\{[\s\S]*\}/);
    if (!braceMatch) return undefined;
    return parseOrUndefined(braceMatch[0]);
  }

  return parseOrUndefined(match[1]);
}

function parseOrUndefined(json: string): AgentOutput | undefined {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const passed = typeof parsed.passed === "boolean" ? parsed.passed : false;

    let summary = typeof parsed.summary === "string" ? parsed.summary : "";
    if (!summary) {
      summary = buildSummaryFromDetails(parsed);
    }

    const { passed: _, summary: __, ...rest } = parsed;
    return {
      passed,
      summary,
      details: Object.keys(rest).length > 0 ? rest : undefined,
    };
  } catch {
    return undefined;
  }
}

/**
 * Build a summary from common agent output patterns without knowing
 * agent-specific field names.
 *
 * Walks the parsed object and collects array-length annotations for
 * any top-level key whose value is an object with array fields.
 */
function buildSummaryFromDetails(parsed: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "passed" || key === "summary") continue;
    if (isRecord(value)) {
      for (const [subKey, subValue] of Object.entries(value)) {
        if (Array.isArray(subValue) && subValue.length > 0) {
          parts.push(`${subValue.length} ${subKey}`);
        }
      }
    }
  }
  return parts.length > 0 ? parts.join(", ") : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
