# NOTES — save-restore-tools-exit-flow (#87)

## Current task
- Subtask 3: Rename defaultTools → savedTools

## Task list / AC checklist
- [x] AC 1: SessionAgent.mount() saves pre-flow tools before overriding (pre-existing)
- [x] AC 2: SessionAgent.destroy() restores original tools (pre-existing)
- [x] AC 3: /exit-flow finds in-session agent, triggers destroy → tool restore
- [x] AC 4: /exit-flow when no flow active notifies "No active flow to exit"
- [x] AC 5: destroy() without mount() is backwards-compatible
- [x] AC 6: Double mount() does not overwrite original tools with flow tools
- [x] AC 7: unmount() is no-op for tool restore when savedTools is empty
- [x] AC 8: FlowExitCommand uses supervisor.destroyAgent(id)
- [x] AC 9: FlowExitCommand handles per-agent destroy failures gracefully
- [x] AC 10: Field renamed defaultTools → savedTools
- [ ] AC 11: Command base: specManager and toolRegistry are optional
- [ ] AC 12: InSessionAgent removed; SessionAgent extends Agent directly; ADR 0007 amended

## Subtask plan
- [x] Sub 1: SessionAgent re-entrancy guard + orphaned destroy guard
- [x] Sub 2: FlowExitCommand → destroyAgent + error resilience
- [x] Sub 3: Rename defaultTools → savedTools
- [ ] Sub 4: Command base class — make specManager, toolRegistry optional
- [ ] Sub 5: Remove InSessionAgent + amend ADR 0007

## Decisions made this session
- Sub 1: mount() guard uses `defaultTools.length === 0` check (not a stack) — re-entrancy is a bug path, not a designed feature
- Sub 1: unmount() guard combined `this.pi && this.defaultTools.length > 0` — covers both never-mounted and empty-saved cases
- Sub 2: destroyAgent loop uses Error[] collection with conditional error vs success notification path — on any failure, skip LLM exit message to preserve flow context
- Sub 2: test spies use call-through (vi.spyOn without mockImpl) not mockResolvedValue — real destroy→unmount chain runs, isMounted assertions ground in real behavior

## Next action on resume
- Run build loop for Subtask 4: Command base class — make specManager, toolRegistry optional
