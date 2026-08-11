# NOTES — agents-detail-overlay-model-title

## Current task

- Subtask 1: Add model/thinkingLevel to data types

## Task list / AC checklist

- [ ] Agent detail overlay title shows `<agent-name> - <model> (<effort>)` when both model and thinkingLevel are present
- [ ] Title gracefully handles missing model (shows just agent name)
- [ ] Title gracefully handles missing thinkingLevel (omits the effort part)
- [ ] Title gracefully handles both missing (shows just agent name)
- [ ] All existing tests pass
- [ ] `npx tsc --noEmit` passes after each subtask

## Subtask plan

- [x] **Subtask 1**: Add model/thinkingLevel to data types — `AgentEntryBase.ts` + `api.ts`
- [ ] **Subtask 2**: Thread model/thinkingLevel through AgentViewerOverlay — `deliverStatusEvent` and `connect`
- [ ] **Subtask 3**: Add setTitle to BorderedContainer for dynamic titles
- [ ] **Subtask 4**: Render dynamic title in AgentDetailView
- [ ] **Subtask 5**: Update tests

## Decisions made this session

- Subtask 1 complete: added `model?: string` and `thinkingLevel?: ThinkingLevel` to `AgentEntryBase` and extended `AgentQuery` `specification` in `api.ts` (type-only change, no runtime/test edits). `ThinkingLevel` imported from `@earendil-works/pi-agent-core` (defined in `dist/types.d.ts`).
- Validation passed: `tsc --noEmit` (exit 0), eslint + prettier clean, full monorepo vitest run 107 files / 2043 tests passed. Reverted incidental `package-lock.json` npm-install normalization.

## Next action on resume

- Run Subtask 2: Thread model/thinkingLevel through AgentViewerOverlay
