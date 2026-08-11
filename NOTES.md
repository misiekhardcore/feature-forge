# NOTES — fix fetch_pr_comments hardcoded repo

## Current task
- Complete: flow.json + orchestrator.md + roundtrip tests for owner/repo parametrization

## Task list / AC checklist
- [x] AC1: `fetch_pr_comments` accepts `owner` and `repo` params (flow.json)
- [x] AC2: `pr_info` step uses `--repo {{owner}}/{{repo}}` instead of hardcoded `misiekhardcore/feature-forge`
- [x] AC3: `review_threads` step uses `-F owner={{owner}} -F repo={{repo}}` instead of hardcoded values
- [x] AC4: `orchestrator.md` Phase 1 instructs deriving `owner` and `repo` from current directory
- [x] AC5: `orchestrator.md` Phase 3 passes `owner` and `repo` to `fetch_pr_comments`
- [x] AC6: `orchestrator.md` removes hardcoded `misiekhardcore/feature-forge` references
- [x] AC7: Tests updated for new params and context
- [x] AC8: All shell templates resolve with no `{{...}}` survivors

## Subtask plan
- [x] **Subtask 1**: `flow.json` — add `owner`/`repo` params to `fetch_pr_comments`, template them into both shell commands
- [x] **Subtask 2**: `orchestrator.md` — update Phase 1 (derive owner/repo from `gh repo view`), Phase 2 (remove hardcoded reference), Phase 3 (pass params), Phase 3 fallback (generalize "main checkout" reference)
- [x] **Subtask 3**: `flow-roundtrip.test.ts` — update param assertion for `fetch_pr_comments`, add `owner`/`repo` to context params

## Decisions made this session
- Subtask 1 (flow.json) was already committed. The verify gate (`check` routine) flagged AC4–AC8 as critical: `fetch_pr_comments` requires 3 params but the orchestrator docs still only passed `pr`, so the flow was non-functional in between subtasks.
- Iteration 3 completed the remaining ACs: `orchestrator.md` Phase 1 now derives owner/repo from the current directory (`gh repo view --json nameWithOwner`), Phase 2/3 no longer hardcode `misiekhardcore/feature-forge`, Phase 3 passes `owner`/`repo` to `fetch_pr_comments`; `flow-roundtrip.test.ts` updated for the new params and shell-command context (roundtrip suite back to green).
- The blank-line addition in `packages/cli/src/flows/implement/orchestrator.md` (flagged as scope creep by verify) is prettier-required: `prettier --check` fails without it, so it is retained.
- Validation: lint, typecheck, and all 2043 tests pass (roundtrip suite 24/24). `npm test -- --coverage` fails its global branch threshold (85.91% < 90%) but this is pre-existing on `origin/main` — verified with a pristine worktree at `origin/main` producing byte-identical numbers (91.81/85.91/91.24/92.37, same totals). Zero coverage impact from this change.

## Next action on resume
- None — all subtasks for "fix fetch_pr_comments hardcoded repo" are complete. Push the branch; the coverage branch-threshold failure is a pre-existing repo-wide baseline unrelated to this change.
