# NOTES — fix #197 — re-prompt mechanism for invalid agent output

## Current task
- Implementing `retry()` method on PiSubprocessAgent and calling it from AgentStepExecutor when parseJson output is missing

## Task list / AC checklist
- [x] AC-1: When parseJson:true and no JSON block, agent.retry() is called
- [x] AC-2: After successful retry with valid JSON, result is parsed and returned
- [x] AC-3: After max retries (2) without valid JSON, fallback used
- [x] AC-4: parseJson:false or JSON present → no retry
- [x] AC-5: PiSubprocessAgent.retry() correctly awaits agent_end, extracts text, updates this.result
- [x] AC-6: All existing tests pass; new tests cover retry paths

## Subtask plan
- [x] Subtask 1: Add retry() to SubprocessAgent base, implement in PiSubprocessAgent, call from AgentStepExecutor, add tests

## Decisions made this session
- Dropped flow.json prompt changes — prompt-only fix is a nudge, not a guarantee (user decision)
- Re-prompt mechanism is the programmatic guard: agent.retry() sends correction prompt, waits for corrected response, max 2 attempts

## Update — iteration 5 (final re-validation)
- Full validation loop re-run on current branch tip: `npm run fix` exit 0 (no changes needed), `npm run lint` exit 0 (6 tasks), `npm run typecheck` exit 0 (10 tasks), `npm run test` exit 0 (103 files / 1942 tests), e2e 9 files / 60 tests exit 0.
- Coverage gate exit 1 re-verified as PRE-EXISTING baseline debt with an apples-to-apples fresh-worktree comparison (clean npm ci at 3500e7b0): origin/main branches 86.39% (1676/1940) vs this branch 86.42% (1687/1952) in the same environment — no regression, marginally better. The ws's lower 84.45% is a workspace artifact: empty ws node_modules makes `@feature-forge/tui`/`@feature-forge/shared` resolve up to the main repo, under-instrumenting tui views.
- Modified-file per-file coverage (clean env): PiSubprocessAgent.ts 97.93% stmts / 94.87% branches; AgentStepExecutor.ts 98.78% / 95.74%.
- No uncommitted source changes; branch ahead of origin/main by 3 commits (df5bc82c, abdbdf1c, 45c71f9e).

## Next action on resume
- DONE — build loop complete, all ACs green
- Validation (2026-08-04): fix/lint/typecheck exit 0; test 103 files / 1941 tests passed (incl. retry tests in AgentStepExecutor.test.ts + PiSubprocessAgent.test.ts). Coverage gate exit 1 is pre-existing baseline debt (no regression vs origin/main).
- Commits: df5bc82c (feat), abdbdf1c (fix review findings) — branch ahead of origin/main by 2 commits.

## Update — iteration 2 (review/verify fixes)
- Addressed all four review findings (recorded in self-learning memory 22:34 UTC):
  1. Forward abort signal into retry loop (`agent.retry(correctionPrompt, { signal })`)
  2. Bound retry with configured task timeout (`ForgeConfig.getInstance().getTaskTimeoutMs()`)
  3. Restructured `_collectResponse` so onEvent subscriptions are unsubscribed on every exit path (incl. prompt rejection)
  4. Added tests: transport-error breaks retry loop, signal forwarding, timeout bounding, no listener leaks
- Validation: fix/lint/typecheck/test all exit 0 (1941 tests). Coverage gate exit 1 is pre-existing debt — baseline origin/main 84.4% branches vs 84.45% here (no regression).
- Committed as `abdbdf1c` on top of `df5bc82c`.

## Update — iteration 4 (review findings from iteration 3)
- Addressed three outstanding review findings (documented as known gaps in self-learning memory 22:48-22:58 UTC):
  1. Added `addEventListener('abort', onAbort)` in `PiSubprocessAgent.retry()` mirroring `executeTask`, calling `rpcClient.abort()` on mid-retry cancellation, with `removeEventListener` in `finally`
  2. Replaced bare `catch { break; }` in AgentStepExecutor retry loop with `catch (error)` that logs `logger.warn("Agent retry failed, falling back to original output", { instructionId, error })` before breaking
  3. Renamed `unsubs` to `unsubscribeHandlers` in `_collectResponse` per naming convention
- New test: PiSubprocessAgent "calls rpcClient.abort when signal fires mid-retry"; extended AgentStepExecutor transport-error test to assert the warning is logged
- Validation (2026-08-04): fix/lint/typecheck exit 0; test 103 files / 1942 tests passed; e2e 9 files / 60 tests passed. Coverage gate exit 1 is pre-existing baseline debt (84.45% branches, identical to prior measurement; origin/main baseline 84.4% — no regression).
