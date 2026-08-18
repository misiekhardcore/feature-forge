# PR #220 rework — close pre-existing errors + coverage gaps (workspace: ws-df09a612)

> NOTE: this workspace is now driving the R3a follow-up build loop (review
> failed twice on earlier iterations; current head passes review with only
> P2 observations).

## Session

- PR: #220 (branch `forge/ws-dd371890`, OPEN, MERGEABLE)
- Base: main @ d25a250e; PR head: 7fa533c3
- User rule (saved to vault feature-forge/core.md): close every pre-existing
  error or test-coverage gap surfaced during validation — even when unrelated
  or pre-existing; never reclassify-and-move-on.

## Acceptance criteria (this rework)

1. [ ] Coverage gate passes: `npm test -- --coverage` exits 0 (branch
       threshold 90% met; baseline branch coverage 88.58% → need +~32 covered
       branches).
2. [ ] `npm -w @feature-forge/cli run test:e2e` works (e2e script quirk F2).
3. [ ] Flaky `AgentCreationError` test (5s timeout under full-suite load,
       observed in S3) made deterministic.
4. [ ] Supervisor same-spec id collision (F4) — decide + implement (see
       decision below).
5. [ ] Full validation loop passes on the rework head.

## Environment finding (fixed)

The rework worktree was created without a dependency install, so package
imports (`@feature-forge/tui`) resolved to the MAIN repo's node_modules →
symlinks to main's packages (pre-PR code). The 6 tui test failures in the
first coverage run were this environment artifact, NOT a code regression
(tests pass against the worktree source once deps are installed). Fix:
`npm ci` in the worktree. The 7th failure (github.e2e 504) is live-network
flakiness — tracked separately below.

## Coverage gap measurement

Baseline (worktree head, deps installed): branches 1987/2243 = 88.59% →
need +31 covered branches for 90%. Top gaps (uncovered branches):
ForgeConfig 29, ConfigLoader 20, e2e helpers 13, test-utils 12,
debug/test-loop-routine 12, ParentSocketServer 11, ToolRenderer 11,
AgentViewerOverlay 10, RoutineRefStepExecutor 9, ExpressionEvaluator 9,
FlowLoader 8.

## Subtask plan (refined)

- R1: done (npm ci; 269 tui tests green; full 2197 green).
- R2: e2e script fix (vitest --root in cli script + root script + CONTRIBUTING
  update).
- R3a: ForgeConfig branch coverage (+~29) — ForgeConfig.test.ts.
- R3b: ConfigLoader branch coverage (+~20) — ConfigLoader.test.ts.
- R3c: tui ToolRenderer (+11) + AgentViewerOverlay (+10).
- R3d: cli ExpressionEvaluator (+9) + RoutineRefStepExecutor (+9) +
  FlowLoader (+8).
- R3e: fallback if still short — ParentSocketServer / debug test-loop-routine.
- R4: flaky-test guards: AgentFactory.test timeout headroom under load;
  github.e2e live-API retry on transient 5xx.
- R5: supervisor same-spec collision — DESIGN DECISION, surfaced to user;
  not implemented in this pass (changes agent identity + overlay
  persistence keying; brief marked it a separate decision).

## Current task

Dispatching R2 (e2e script fix), then R3a-d (coverage), R4 (flaky guards).

## Next action on resume

Integrate each result → final AC gate → commit any stragglers → rebase →
push forge/ws-dd371890 → destroy workspace → summarize on PR #220.

## Log

- Rule saved to vault (core.md + log.md).
- Rework workspace created on forge/ws-dd371890: ws-df09a612.
- First coverage run: 7 failures — 6 tui (stale node resolution, env) +
  1 github.e2e HTTP 504 (network). Diagnosed: no npm install in worktree.
