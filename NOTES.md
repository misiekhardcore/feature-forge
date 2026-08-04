# NOTES — resolve-pr-feedback flow (#40)

## Current task
- Subtask 1 complete: GitHub API module (`packages/cli/src/github.ts`) — next up is Subtask 2

## Task list / AC checklist
- [ ] `/resolve-pr-feedback` fetches unresolved PR comments from GitHub
- [ ] LLM triages each comment as action item or non-action item
- [ ] Non-action items get 👍 or explanatory reply as appropriate
- [ ] Actionable comments are grouped and fed to the implement pipeline (`run_build_loop`)
- [ ] After fix cycle, handled comments get 👍 or reply as appropriate
- [ ] Re-running the command only processes still-unresolved comments
- [ ] All tests pass (`npm run check`)

## Subtask plan
- [x] Subtask 1: GitHub API module (`packages/cli/src/github.ts`) — getPullRequest via `gh pr view`, getUnresolvedComments via graphql reviewThreads + REST issue comments; execFileSync runner; 100% branch coverage
- [ ] Subtask 2: Cross-flow routine ref dot notation (RoutineRefStepExecutor)
- [ ] Subtask 3: Flow definition (`flow.json`)
- [ ] Subtask 4: Orchestrator persona (`orchestrator.md`)
- [ ] Subtask 5: Round-trip test

## Decisions made this session
- Thin gh wrapper, no Octokit dependency
- Comment grouping: file + review thread; fallback to file-only for general comments
- Resolved detection: review comments via pull_request_review_threads; issue comments always unresolved
- Dot notation in RoutineRefStepExecutor: parse `flow.routine` format, inline only matching routine
- Subtask 1: used `execFileSync` (not `execSync`) — execSync has no args-array overload (TS2554); execFileSync matches repo convention (execFile in GitWorktreeProvider)
- Review thread resolved status fetched via graphql `reviewThreads(isResolved)`, comments flattened per thread
- Global branch coverage 84.38% < 90% fails on origin/main baseline too (verified via stash) — pre-existing, not from this subtask

## Next action on resume
- Subtask 2: extend RoutineRefStepExecutor to parse `flow.routine` dot-notation (split on '.'), inline only the matching routine
