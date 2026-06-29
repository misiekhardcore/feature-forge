# NOTES — refactor/routine-flow-implement

## Current task

- All done — ready for commit

## Task list

- [x] Step 1: FlowInstruction.ts — schema renames
- [x] Step 2: New OrchestratorAgent.ts
- [x] Step 3: orchestrator.md — YAML frontmatter + persona-only
- [x] Step 4: flow.json — rename fields
- [x] Step 5: FlowLoader.ts — update field references
- [x] Step 6: helpers.ts — add --system-prompt
- [x] Step 7: Spec files (build/review/verify/research.md) — persona-only
- [x] Step 8: AgentStepExecutor.ts — rename fields
- [x] Step 9: ResearchCommand.ts — remove specParams
- [x] Step 10: generate-flow-schema.ts — sync fields
- [x] Step 11: OrchestratorCommand.ts — thin trigger
- [x] Step 12: All test updates
- [x] Step 13: Validation — npm run check, tsc --noEmit, npm test -- --coverage

## Decisions made this session

- OrchestratorAgent uses async static factory `create()` instead of sync constructor (why: avoids blocking event loop on file read, consistent with CORE.md learning)
- activeTools moved from flow.json to orchestrator.md YAML frontmatter (why: separates tool declaration from flow definition schema)
- IPC-level SpawnAgentParams keeps `spec`/`specParams` field names unchanged (why: decouples flow schema from IPC protocol)

## Open questions

- None

## Next action on resume

- Commit and push
