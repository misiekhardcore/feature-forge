# NOTES — save-restore-tools-exit-flow (#87)

## Current task
- Subtask 1: SessionAgent re-entrancy guard + orphaned destroy guard — DONE (validated)

## Task list / AC checklist
- [ ] AC 1: SessionAgent.mount() saves pre-flow tools before overriding
- [ ] AC 2: SessionAgent.destroy() restores original tools
- [ ] AC 3: /exit-flow finds in-session agent, triggers destroy → tool restore
- [ ] AC 4: /exit-flow when no flow active notifies "No active flow to exit"
- [x] AC 5: destroy() without mount() is backwards-compatible (guard skips when pi undefined)
- [x] AC 6: Double mount() does not overwrite original tools with flow tools (mount guard)
- [x] AC 7: unmount() is no-op for tool restore when savedTools is empty (unmount guard)
- [ ] AC 8: FlowExitCommand uses supervisor.destroyAgent(id)
- [ ] AC 9: FlowExitCommand handles per-agent destroy failures gracefully
- [ ] AC 10: Field renamed defaultTools → savedTools
- [ ] AC 11: Command base: specManager and toolRegistry are optional
- [ ] AC 12: InSessionAgent removed; SessionAgent extends Agent directly; ADR 0007 amended

## Subtask plan
- [x] Sub 1: SessionAgent re-entrancy guard + orphaned destroy guard
- [ ] Sub 2: FlowExitCommand → destroyAgent + error resilience
- [ ] Sub 3: Rename defaultTools → savedTools
- [ ] Sub 4: Command base class — make specManager, toolRegistry optional
- [ ] Sub 5: Remove InSessionAgent + amend ADR 0007

## Decisions made this session
- mount() captures defaultTools only when empty (guard, not stack) — re-entrancy is a bug path, not a feature
- unmount() skips setActiveTools when saved list is empty — avoids clobbering active tools with []
- Added 3 tests (double-mount, unmount-without-mount, empty-saved-tools); first and third fail without guards (TDD verified)
- Global branch coverage gate (90%) is PRE-EXISTING failure (baseline 84.24% vs 84.34% with change); SessionAgent.ts itself at 100% branches

## Next action on resume
- Run build loop for Subtask 1: SessionAgent re-entrancy + orphaned destroy guard
