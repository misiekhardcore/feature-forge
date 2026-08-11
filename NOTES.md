# NOTES — fix-agent-list-display

## Current task

- Subtask 3: finalize AgentListView.test.ts assertions (label format test done; remaining coverage check)

## Task list / AC checklist

- [x] AC1: Right column shows human-readable parsed messages instead of raw event types (no "agent_end: completed", no "message_update", no raw JSON in tool updates)
- [x] AC2: Left column is wide enough so elapsed time is not cut off (maxPrimaryColumnWidth: 50)
- [x] AC3: Left column does not render agent role in brackets (removed role from label)
- [x] AC4: Left column does not render status label after hyphen (removed getStatusLabel from label)

## Subtask plan

- [x] Subtask 1: Fix right column — `formatStreamEvent` / `formatDetail` in AgentViewerOverlay.ts
- [x] Subtask 2: Fix left column — label format + column width in AgentListView.ts
- [x] Subtask 3: Update tests in AgentViewerOverlay.test.ts and AgentListView.test.ts (both parts done)

## Decisions made this session

- formatStreamEvent no longer prefixes `eventType: `; stream lines show only the self-describing detail (why: detail is already descriptive, e.g. "read", "completed")
- tool_execution_update now uses AgentDisplayHelpers.serializeToolResultText instead of raw JSON.stringify (why: handles AgentToolResult `{content:[{type:text}]}` shapes)
- Fixture-based tests writing literal .stream files keep the old format — they simulate legacy on-disk content rendered verbatim, not formatStreamEvent output
- Worktree had empty node_modules; tests were silently resolving @feature-forge/tui to the main repo copy — ran npm install in the worktree (why: validation must exercise worktree code)
- Coverage branch threshold (90%) fails at base commit too (87.34%) — pre-existing, not a regression from this change

## Next action on resume

- Full validation already green (tsc, vitest AgentListView 10/10, full suite 2043 tests, lint/fix clean). Hand off: commit/push via flow, then run verify phase.
