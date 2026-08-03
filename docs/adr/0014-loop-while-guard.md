# ADR 0014: Loop while-guard and structured routine status

**Date:** 2026-08-03
**Status:** Accepted

## Context

A routine sometimes needs to skip a loop body entirely with a structured
status — e.g. "tests already green, skip the build loop." The existing
loop instruction has do-while semantics: the body always executes at least
once before `continueWhile` is checked. The only way to avoid execution
was to set `maxIterations: 0`, which is a schema violation.

Two designs were considered for structured early exit, per issue #53:

1. **Conductor-style `terminate` step** — a graph-level instruction with
   `status: success | failed`. This bakes control-flow decisions into the
   deterministic graph, consistent with Conductor's design where the whole
   graph is deterministic and routes carry the logic.

2. **Loop primitive promotion** — extend our existing `LoopInstruction`
   with a pre-condition `while` guard, creating a while-do-while hybrid.

## Decision

### D.1 — Loop while-guard (chosen over terminate step)

Add an optional `while?: string` field to `LoopInstructionSchema`. The
expression reuses the existing `ExpressionParser` grammar (boolean-only,
same as `continueWhile`). The while-guard is evaluated **before** the
first iteration; when false, the loop records a structured "skipped"
`InstructionResult` with `passed: true` and the routine continues.

**Why not a terminate step:** feature-forge deliberately splits
control-flow differently from Conductor. The LLM orchestrator sits at the
orchestration boundary (decides which routine, whether to retry, whether
to open the PR), and inside a routine control flow is the `loop`
instruction (`maxIterations` + do-while `continueWhile`) — not a
terminate node. A terminate step would be a new instruction type, new
executor, new schema, and would interact with the existing loop executor
and the orchestrator boundary in ambiguous ways. The loop-guard is a
3-line schema change + a condition check — the smaller, more composable
change that matches how `ExpressionParser` and `FlowContext` already
interoperate.

### D.2 — Structured RoutineResult status (complementary)

Enrich `RoutineResult` with `status: "success" | "skipped" | "failed"`
and optional `reason: string`. The status is derived in
`RoutineExecutor.buildResult`:

- `"failed"` if any non-blocking step result has `passed: false`
- `"skipped"` if any result indicates a skipped loop
- `"success"` otherwise

The existing `passed: boolean` field is preserved for backward
compatibility with the orchestrator LLM's JSON contract. `passed` is
`true` for both `"success"` and `"skipped"` (the skip was intentional).

Loop skip detection uses a structured check rather than string-scanning
raw JSON — `InstructionResult.parsed` is checked for a `skipped` flag
produced by `LoopStepExecutor`.

## Consequences

- **Positive**: Loops can now be skipped entirely without schema
  violations. The orchestrator LLM receives a richer `status` field to
  reason about routine outcomes — distinguishing intentional skips from
  true completions.

- **Negative**: Two new optional fields on `RoutineResult` (`status`,
  `reason`) increase the surface area. All consumers of `RoutineResult`
  (primarily `RoutineTool`) must be aware of the new fields, though they
  are additive and default to `"success"`.

- **Deferred**: A standalone `terminate` instruction was considered but
  rejected as less idiomatic. It can be revisited if a real routine
  requires mid-routine termination that neither loop-guard nor
  result-status can express.
