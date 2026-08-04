# NOTES — rework #198 — resolve relative path patterns to absolute

## Current task
- Verify feedback resolved: added in-process integration test driving real restricted tool calls (write/bash/negation) through real pi extension machinery

## Task list / AC checklist
- [x] `.pi` symlink removed from the branch
- [x] `projectRoot` param added to `activateToolRestrictions`
- [x] Relative path-patterns resolved to absolute before matching (path-based tools only)
- [x] Bash command patterns left untouched
- [x] `matchAny` removed — direct `minimatch(value, pattern, { dot: true })` in `isValueAllowed`
- [x] Call sites pass `process.cwd()` as `projectRoot`
- [x] Orchestrator spec uses relative `.forge/worktrees/**/NOTES.md`
- [x] All existing + new unit tests pass
- [x] e2e gap (verify finding): new `tool-restrictions-interceptor.e2e.test.ts` drives real restricted `write`/`bash` tool calls through real `ExtensionRunner` dispatch + real `spec-resolution` wiring (fixture loaded via pi's real loader)

## Subtask plan
- [x] Fix tool-restrictions.ts + call sites + orchestrator.md + tests
- [x] Close verify e2e gap with in-process integration test

## Decisions made this session
- Resolve relative path patterns to absolute (prepend projectRoot) instead of stripping absolute values to relative — cleaner, keeps patterns as-is from user's perspective (why: rejected value-stripping as "shitty", rejected **/ fallback as too permissive)
- Close the e2e gap in-process: a subprocess e2e cannot drive an LLM tool call (no provider in test env), so load the real child-side wiring (spec-resolution → tool-restrictions) through pi's real loader + `ExtensionRunner` and emit real `tool_call` events (why: real dispatch + real handlers; only runtime plumbing stubbed)

## Next action on resume
- Run full validation loop (fix, lint, typecheck, test, e2e, coverage) and commit
