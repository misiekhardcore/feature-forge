# NOTES — fix fetch_pr_comments hardcoded repo

## Current task
- Subtask 2: orchestrator.md — derive/pass owner+repo, remove hardcoded misiekhardcore/feature-forge

## Task list / AC checklist
- [x] AC1: `fetch_pr_comments` accepts `owner` and `repo` params (flow.json)
- [x] AC2: `pr_info` step uses `--repo {{owner}}/{{repo}}` instead of hardcoded `misiekhardcore/feature-forge`
- [x] AC3: `review_threads` step uses `-F owner={{owner}} -F repo={{repo}}` instead of hardcoded values
- [ ] AC4: `orchestrator.md` Phase 1 instructs deriving `owner` and `repo` from current directory
- [ ] AC5: `orchestrator.md` Phase 3 passes `owner` and `repo` to `fetch_pr_comments`
- [ ] AC6: `orchestrator.md` removes hardcoded `misiekhardcore/feature-forge` references
- [ ] AC7: Tests updated for new params and context
- [ ] AC8: All shell templates resolve with no `{{...}}` survivors

## Subtask plan
- [x] **Subtask 1**: `flow.json` — add `owner`/`repo` params to `fetch_pr_comments`, template them into both shell commands
- [ ] **Subtask 2**: `orchestrator.md` — update Phase 1 (derive owner/repo from `gh repo view`), Phase 2 (remove hardcoded reference), Phase 3 (pass params), Phase 7 fallback (generalize "main checkout" reference)
- [ ] **Subtask 3**: `flow-roundtrip.test.ts` — update param assertion for `fetch_pr_comments`, add `owner`/`repo` to context params

## Decisions made this session
- Subtask 1 done: `fetch_pr_comments` params now `pr`, `owner`, `repo`; `pr_info` uses `--repo {{owner}}/{{repo}}`; `review_threads` uses `-F owner={{owner}} -F repo={{repo}}`. JSON valid, flow loads (22/24 roundtrip tests pass). The 2 failing tests are the expected param-mismatch and `{{...}}` survivor tests — to be fixed in Subtask 3 (tests) after Subtask 2 (orchestrator.md provides owner/repo in context).

## Next action on resume
- Subtask 2: edit `packages/cli/src/personas/orchestrator.md` — Phase 1 derive owner/repo from `gh repo view --json nameWithOwner`; Phase 3 pass `owner`/`repo` to `fetch_pr_comments`; remove hardcoded `misiekhardcore/feature-forge`
