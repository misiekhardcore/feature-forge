# TODO

## Done

- [x] `/discover` — interactive interview → GitHub issue
  - [x] Command registration + interview prompt
  - [x] Capture issue URL via `tool_result` hook + `pi.appendEntry()`
  - [x] Reconstruct state on session resume via `session_start`
  - [x] Test: issue URL regex, findDiscoverIssueUrl, resolveIssueRef, prompt loading
  - [ ] Manual acceptance: full pause/resume cycle with live pi session
- [x] `/define` — background research + architecture + design + data model + API surface + file plan + work order + risks → implementation plan in issue
  - [x] Command registration + orchestration prompt
  - [x] Issue resolution: args (URL or number) → /discover state → error notification
  - [x] Bare number auto-expanded to full GitHub URL via git remote

## Backlog
- [ ] `/implement` — build → review → verify → PR
- [ ] `/wrap-up` — worktree cleanup
