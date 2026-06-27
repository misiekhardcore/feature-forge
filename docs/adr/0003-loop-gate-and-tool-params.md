# ADR 0003: Loop gate on builder outcome and typed toolParams

**Date:** 2026-06-26
**Status:** Accepted

## Context

Two correctness gaps in the flow execution contract:

1. **Builder invisible to loop exit condition** — The current `continueWhile`
   `!results.review?.parsed?.passed || !results.verify?.parsed?.passed`
   only gates on review and verify. A crashed builder (e.g., network error,
   parse failure) is invisible — the loop exits after max iterations with no
   indication that the builder never produced working code. A `passed: true`
   review/verify from stale prior-round output can greenlight an empty repo.

2. **`toolParams` untyped** — The `FlowDefinition.toolParams` field was
   `string[]`, providing no descriptions the orchestrator LLM can use to
   plan calls. The FlowEngineTool (future) has no schema to build a typed
   Pi tool from.

## Decision

### D.1 — Builder outcome as loop gate

The builder agent receives `parseJson: true` and a prompt instructing it to
end with a JSON outcome block:

```json
{ "passed": true|false, "summary": "..." }
```

The `continueWhile` expression becomes:

```
!results.builder?.parsed?.passed || !results.review?.parsed?.passed || !results.verify?.parsed?.passed
```

The `InstructionResult.parsed` type is widened to a discriminated union:

```typescript
type ParsedResult = ReviewFindings | BuildOutcome;

interface ReviewFindings {
  kind: "review";
  passed: boolean;
  findings: { critical: string[]; warnings: string[]; info: string[] };
}

interface BuildOutcome {
  kind: "build";
  passed: boolean;
  summary: string;
}
```

This is a type-only change — the `FlowEngine` (not yet written) will populate
`BuildOutcome` from the builder's JSON. The expression evaluator only accesses
`.parsed.passed` which both shapes share, so no evaluation changes are needed.

The engine's error normalization path (already documented in §6.4) sets
`parsed: { passed: false, ... }` on catch — with the builder now
`parseJson: true`, a throw → `parsed.passed === false` → loop continues.

### D.2 — Typed toolParams

`toolParams` changes from `Type.Array(Type.String())` to:

```typescript
Type.Array(
  Type.Object({
    name: Type.String({ minLength: 1 }),
    description: Type.Optional(Type.String()),
  }),
);
```

Each entry is `{ name: string; description?: string }`. The FlowEngineTool
(future todo #12) builds a TypeBox `Type.Object(...)` from this array,
registering a self-describing Pi tool with parameter docs the orchestrator
LLM can consume.

## Consequences

| File                                       | Change                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `FlowContext.ts`                           | `ParsedResult` discriminated union; `ReviewFindings`, `BuildOutcome` exported                        |
| `FlowContext.test.ts`                      | All parsed fixtures updated with `kind: "review"`                                                    |
| `implement.json`                           | Builder receives `parseJson: true`, JSON-output prompt, `continueWhile` extended                     |
| `ExpressionEvaluator.test.ts`              | Implement expression tests expanded to 5 cases including builder-pass, builder-fail, builder-missing |
| `FlowInstruction.ts`                       | `toolParams` schema changed to object array                                                          |
| `FlowInstruction.test.ts`                  | validFlow fixture updated, `toolParams` empty-name rejection test added                              |
| `FlowLoader.test.ts`                       | All fixtures updated for new toolParams format, new loadAll tests                                    |
| `PLAN.md` / `UPDATED_FLOW_ARCHITECTURE.md` | Referenced for the carried-forward rationale (`docs/flow-engine.md` removed 2026-06-27)              |
