# NOTES — agents-detail-overlay-model-title

## Current task

- Combined Subtask 2-5 + scroll fix complete: model/thinkingLevel threaded through overlay, dynamic title, scroll-offset drift fix — validation green

## Task list / AC checklist

- [x] Agent detail overlay title shows `<agent-name> - <model> (<effort>)` when both model and thinkingLevel are present
- [x] Title gracefully handles missing model (shows just agent name)
- [x] Title gracefully handles missing thinkingLevel (omits the effort part)
- [x] Title gracefully handles both missing (shows just agent name)
- [x] Scrolling up in agent detail view keeps position stable when new messages arrive (scroll-offset drift fix)
- [x] All existing tests pass
- [x] `npx tsc --noEmit` passes

## Subtask plan

- [x] **Subtask 1**: Add model/thinkingLevel to data types — `AgentEntryBase.ts` + `api.ts`
- [x] **Subtask 2-5 + scroll**: Thread model/thinkingLevel through overlay, add setTitle to BorderedContainer, render dynamic title in AgentDetailView, update tests, fix ScrollableBox scroll-offset drift

## Decisions made this session

- Subtask 1 complete: added `model?: string` and `thinkingLevel?: ThinkingLevel` to `AgentEntryBase` and extended `AgentQuery` `specification` in `api.ts` (type-only change, no runtime/test edits). Validation passed: tsc, eslint, prettier, 107 files / 2043 tests.
- Scroll fix: when autoScroll=false and content grows, increase scrollOffsetEnd by growth amount to keep absolute viewport position stable. Growth adjustment placed AFTER the `scrollOffsetEnd === 0 → autoScroll = true` re-enable check so manual-scroll-to-bottom still follows the stream.
- Dynamic title format: `<agent id> — <model> (<thinkingLevel>)`, omitting missing parts (matches AC `<agent-name> - <model> (<effort>)` rather than the plan snippet's `— (level)` part join).

## Next action on resume

- Combined Subtask 2-5 + scroll fix build loop finished — all validation green (fix, lint, typecheck, 107 files / 2057 tests, coverage no regression). Commit and report.
