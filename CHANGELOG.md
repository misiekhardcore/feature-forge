# Changelog

All notable changes to this project are documented in this file.

## [0.2.0] - 2026-08-11

### Bug Fixes

- Handle EEXIST in worktree symlinks and model preset passthrough (#183)
- Review spec inlines JSON output format, parseJson failure gates correctly (#186)
- Implement flow missing critical pre-PR validation gates (#172) (#188)
- SessionAgent tool layering, excludedTools parsing, and persona ordering (#192)
- Add worktree symlinks to git info/exclude so git never stages them (#193)
- **cli:** Add ESM \_\_dirname polyfill to ForgeInitCommand (#196)
- **cli:** Canonical JSON defaults for forge:init config, replace bash setup with Node.js (#200)
- Support absolute paths in tool restriction glob matching (#198)
- Use heredoc and --body-file to prevent shell escaping in PR body (#202)
- Bash tool restrictions block commands with slashes (e.g. gh api repos/...) (#205)
- Handle chained commands in bash tool restrictions (#206)
- **cli:** Actionable error for shell steps with unresolved or missing cwd
- Simplify agent list display — readable right column and wider left column (#210)
- Parametrize owner/repo in fetch_pr_comments routine (#211)

### Chores

- Init forge
- Release v0.2.0

### Documentation

- Sync flow-rationale maxIterations and round count with PR #208

### Features

- Orchestrator maintains NOTES.md for progress tracking across turns (#189)
- Add set_session_name tool for naming sessions from flows (#190)
- Add while-guard to LoopInstruction and structured RoutineResult status (#53) (#194)
- Save/restore pre-flow tools, exit-flow with destroyAgent, refactor cleanup (#195)
- **cli:** Re-prompt agent when parseJson output is missing (#199)
- **cli:** Add /resolve-pr-feedback flow for PR review comment processing (#201)
- Log retention, rotation, and cleanup to prevent unbounded .forge/logs growth (#203) (#204)
- **cli:** Optional cwd for shell steps, decouple resolve-pr-feedback from workspace state
- **verify:** Decouple verify and review agents from builder.raw unit test output (#207)
- **implement:** Enforce atomic subtask decomposition with 3-round build loop cap (#208)
- **tui:** Show agent model in detail overlay title + fix scroll drift (#209)

### Refactoring

- Add resolved flag to resolveModel return type (#184)
