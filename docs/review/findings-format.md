# Review Findings Format

All review skill outputs follow a standard format for findings, enabling
automated aggregation and merge-rule evaluation.

## Output Structure

Every review skill MUST produce two things:

1. A prose summary (optional, for readability)
2. A JSON block with the canonical result

### JSON Block

```json
{
  "passed": true,
  "findings": [
    {
      "file": "packages/cli/src/foo.ts",
      "line": 42,
      "issue": "Unhandled null case in parseConfig",
      "severity": "P0",
      "confidence": 0.95
    }
  ]
}
```

### Field Descriptions

| Field        | Type     | Description |
|-------------|----------|-------------|
| `passed`    | boolean  | `true` only if zero P0 and P1 findings |
| `findings`  | Array    | List of individual findings |
| `findings[].file` | string | Relative path from workspace root |
| `findings[].line` | number | Line number (1-indexed), or 0 for file-level |
| `findings[].issue` | string | Human-readable description of the issue |
| `findings[].severity` | string | Severity level: `P0`, `P1`, `P2`, or `P3` |
| `findings[].confidence` | number | 0.0 (guessing) to 1.0 (certain) |

### Severity Levels

| Level | Meaning | Action |
|-------|---------|--------|
| **P0** | Blocker — must fix before merge | Hard correctness bug, security vulnerability, data loss |
| **P1** | Major — should fix before merge | Significant architecture violation, type safety issue, missing error handling |
| **P2** | Minor — consider fixing | Convention violation, missing JSDoc, moderate optimisation gap |
| **P3** | Suggestion — optional | Nitpick, style preference, future optimisation idea |

### Inline Prose Format (TOON-style)

For terminal consumption, findings may also be printed in a compact format:

```
file:line | issue | severity | confidence
packages/cli/src/foo.ts:42 | Unhandled null case in parseConfig | P0 | 0.95
```
