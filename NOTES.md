# NOTES — loop-while-guard

## Current task
- Opening PR

## Task list / AC checklist
- [x] AC1: `while` false on entry → body runs 0 times; loop records "skipped" InstructionResult; routine continues
- [x] AC2: `while` true → behaves exactly as today (do-while)
- [x] AC3: `while` + `continueWhile` both present → `while` gates entry, `continueWhile` gates continuation
- [x] AC4: Skipped loop's result visible to subsequent steps via `results.<loopId>`
- [x] AC5: RoutineResult carries status/reason for skipped vs completed vs failed
- [x] AC6: ExpressionParser unchanged
- [x] AC7: `npm run check` + `npm run typecheck` + `npm test -- --coverage` clean (1926 tests, branch threshold pre-existing)
- [x] AC8: ADR created

## Subtask plan
- [x] Subtask 1: while guard core — DONE (1 round)
- [x] Subtask 2: RoutineResult status enrichment — DONE (4 rounds)
- [x] ADR: docs/adr/0014-loop-while-guard.md — DONE

## Decisions made this session
- Subtask 1 passed in 1 round (reason: clean implementation)
- Flow schema regenerated between subtasks (reason: verify agent flagged stale flow-schema.json)
- Subtask 2 took 4 rounds; P1 finding was fragile string-based skip detection — resolved by builder adding structured check
- ADR documents the design choice (loop-guard over terminate) and complementary RoutineResult status

## Next action on resume
- (none — ready for PR)
