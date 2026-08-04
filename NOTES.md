# NOTES — resolve-pr-feedback flow (#40)

## Current task

- Subtask 2 (dot notation) verify-feedback fixes: e2e coverage for flow.routine + malformed-target validation

## Task list / AC checklist

- [ ] `/resolve-pr-feedback` fetches unresolved PR comments from GitHub
- [ ] LLM triages each comment as action item or non-action item
- [ ] Non-action items get 👍 or explanatory reply as appropriate
- [ ] Actionable comments are grouped and fed to the implement pipeline (`run_build_loop`)
- [ ] After fix cycle, handled comments get 👍 or reply as appropriate
- [ ] Re-running the command only processes still-unresolved comments
- [ ] All tests pass (`npm run check`)

## Subtask plan

- [x] Subtask 1: GitHub API module (`packages/cli/src/github.ts`) — getPullRequest via `gh pr view` (headRepository field), getUnresolvedComments via graphql reviewThreads + REST issue comments; execFileSync runner; GitHubApiError with cause; runtime shape validation; cursor/page pagination with caps; 100% branch coverage; e2e contract tests against real gh CLI
- [ ] Subtask 2: Cross-flow routine ref dot notation (RoutineRefStepExecutor)
- [ ] Subtask 3: Flow definition (`flow.json`)
- [ ] Subtask 4: Orchestrator persona (`orchestrator.md`)
- [ ] Subtask 5: Round-trip test

## Decisions made this session

- Thin gh wrapper, no Octokit dependency
- Comment grouping: file + review thread; fallback to file-only for general comments
- Resolved detection: review comments via pull_request_review_threads; issue comments always unresolved
- Dot notation in RoutineRefStepExecutor: parse `flow.routine` format, inline only matching routine
- Verify feedback: reject malformed targets (>2 dot segments or trailing dot) instead of silently truncating; add e2e coverage for flow.routine inline, unknown-routine error, and malformed-target error paths
- Subtask 1: used `execFileSync` (not `execSync`) — execSync has no args-array overload (TS2554); execFileSync matches repo convention (execFile in GitWorktreeProvider)
- Review thread resolved status fetched via graphql `reviewThreads(isResolved)`, comments flattened per thread
- `gh pr view --json` uses `headRepository` not `repository` (invalid in gh 2.93.0); verified field-list contract via e2e test (gh validates fields before branch resolution)
- GitHubApiError extends Error with name 'GitHubApiError' + cause; wraps execFileSync failure, JSON parse failure, and shape-validation failure
- Runtime shape validation (isPrViewData/isReviewThreadsResponse/isIssueComment type guards) at the ghJson boundary — JSON.parse output narrowed before use
- reviewThreads paginated via GraphQL cursor (first:100, after:$cursor, pageInfo); issue comments via REST page=1..N; both abort with GitHubApiError when cap exceeded (5 pages / 10 pages)
- GraphQL guard: `data === null` + errors[] inspection before touching repository fields
- e2e: github.e2e.test.ts validates --json field list against installed gh + round-trips both functions against a real PR (skip-if-no-gh)
- Global branch coverage 84.38% (prev) / 86.46% (origin/main clean baseline) < 90% fails on baseline too — verified via clean worktree + npm ci; my branch improves it to 86.92% — pre-existing, not from this subtask

## Next action on resume

- Re-validate subtask 2: npx tsc --noEmit, vitest run --project cli, vitest run --project cli-e2e, then run_build_loop for Subtask 3: Flow definition + orchestrator persona + round-trip test
