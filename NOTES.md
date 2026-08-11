# NOTES — debug-test-loop-model-effort

## Current task

- Add model and thinkingLevel to debug test-loop-routine mock agents

## Task list / AC checklist

- [x] `ViewerHandle.update` type accepts `model?` and `thinkingLevel?`
- [x] Agent definitions in `simulateRound` include model and thinkingLevel
- [x] `viewer.update()` calls pass model and thinkingLevel
- [x] Typecheck and tests pass

## Subtask plan

- [x] Modify `packages/debug/src/commands/test-loop-routine.ts`: extend `ViewerHandle.update`, add model/thinkingLevel to agentDefs, pass in update calls

## Decisions made this session

- Model/thinkingLevel passed from agentDefs via `agentDefs.find` lookup in scheduleAgent (why: keeps scheduleAgent call sites unchanged, def is closure-scoped)
- Ran `npm install` in worktree (why: worktree node_modules was empty, so `@feature-forge/*` imports resolved to the main repo and 6 tui tests failed against stale main-repo code; sibling worktrees were provisioned the same way)
- Reverted incidental package-lock.json bin-path drift from npm install (why: unrelated to task scope)

## Next action on resume

- Build complete; commit changes and report JSON block
