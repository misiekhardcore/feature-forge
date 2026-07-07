import type { ParsedResult } from "../FlowContext";

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
  if (!match || !match[1]) {
    // Fall back: look for a bare { … } block.
    const braceMatch = raw.match(/\{[\s\S]*\}/);
    if (!braceMatch) return undefined;
    return parseOrUndefined(braceMatch[0]);
  }

  return parseOrUndefined(match[1]);
}

function parseOrUndefined(json: string): ParsedResult | undefined {
  try {
    const parsed = JSON.parse(json) as ParsedResult;

    // Normalize review findings if present.
    if ("findings" in parsed) {
      const critical = parsed.findings.critical ?? [];
      const warnings = parsed.findings.warnings ?? [];
      const info = parsed.findings.info ?? [];
      const summaryParts: string[] = [];
      if (critical.length > 0) summaryParts.push(`${critical.length} critical`);
      if (warnings.length > 0) summaryParts.push(`${warnings.length} warnings`);
      if (info.length > 0) summaryParts.push(`${info.length} info`);
      return {
        kind: "review",
        passed: parsed.passed ?? false,
        summary: summaryParts.length > 0 ? summaryParts.join(", ") : "no findings",
        findings: { critical, warnings, info },
      };
    }

    // Default: build outcome.
    return {
      kind: "build",
      passed: parsed.passed ?? false,
      summary: parsed.summary ?? "",
    };
  } catch {
    return undefined;
  }
}
