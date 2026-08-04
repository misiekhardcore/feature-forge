# NOTES — rework #198 — resolve relative path patterns to absolute

## Current task
- Build loop completed — all checks green, ready for review

## Task list / AC checklist
- [x] `.pi` symlink removed from the branch
- [x] `projectRoot` param added to `activateToolRestrictions`
- [x] Relative path-patterns resolved to absolute before matching (path-based tools only)
- [x] Bash command patterns left untouched
- [x] `matchAny` removed — direct `minimatch(value, pattern, { dot: true })` in `isValueAllowed`
- [x] Call sites pass `process.cwd()` as `projectRoot`
- [x] Orchestrator spec uses relative `.forge/worktrees/**/NOTES.md`
- [x] All existing + new tests pass

## Subtask plan
- [x] Fix tool-restrictions.ts + call sites + orchestrator.md + tests

## Decisions made this session
- Resolve relative path patterns to absolute (prepend projectRoot) instead of stripping absolute values to relative — cleaner, keeps patterns as-is from user's perspective (why: rejected value-stripping as "shitty", rejected **/ fallback as too permissive)

## Next action on resume
- Verify agent: review commit (pattern resolution to absolute; `.pi` removed)
