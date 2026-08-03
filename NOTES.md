# NOTES — loop-while-guard

## Current task
- ADR creation (next task after build)

## Task list / AC checklist
- [x] AC1: `while` false on entry → body runs 0 times; loop records "skipped" InstructionResult; routine continues
- [x] AC2: `while` true → behaves exactly as today (do-while)
- [x] AC3: `while` + `continueWhile` both present → `while` gates entry, `continueWhile` gates continuation
- [x] AC4: Skipped loop's result visible to subsequent steps via `results.<loopId>`
- [x] AC5: RoutineResult carries status/reason for skipped vs completed vs failed
- [x] AC6: ExpressionParser unchanged
- [x] AC7: `npm run check` + `npm run typecheck` + `npm test -- --coverage` clean (subtask 2)
- [ ] AC8: ADR created

## Subtask plan
- [x] Subtask 1: while guard core (FlowInstruction.ts, LoopStepExecutor.ts, FlowLoader.ts, tests) — DONE
- [x] Subtask 2: RoutineResult status enrichment (RoutineResult.ts, RoutineExecutor.ts, tests) — DONE (2 rounds; review passed in round 2)
- [ ] ADR: docs/adr/0014-loop-while-guard.md

## Decisions made this session
- Subtask 1 passed in 1 round; 12 tests added, full suite green (reason: clean implementation)
- Verify agent warned about stale flow-schema.json; regenerating before Subtask 2 (reason: schema drift from new `while` field)
- Status precedence: "failed" wins over "skipped" — a routine that both skips and fails reports "failed" (reason: failure is the actionable signal for the orchestrator)
- Skipped detection scans raw result JSON for `"skipped":true`, the exact producer format emitted by LoopStepExecutor via JSON.stringify (reason: producer-consumer contract verified; no parser change needed)
- Global branch coverage threshold (90%) is unmet at 84.35% — pre-existing on clean main, vitest.config.ts untouched (reason: documented in memory, not a regression)
- RoutineTool threads `status` into routine-tool details additively (reason: LLM needs the three-state signal; consumer change is backwards-compatible)

## Next action on resume
- Create ADR `docs/adr/0014-loop-while-guard.md` covering: while-guard entry gate, continueWhile continuation gate, skipped-result contract (`{iterations:0, skipped:true}`), RoutineResult status/reason model


