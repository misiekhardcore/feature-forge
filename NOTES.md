# NOTES — save-restore-tools-exit-flow (#87)

## Current task
- Subtask 5: Remove InSessionAgent + amend ADR 0007

## Task list / AC checklist
- [x] AC 1-9: Core save/restore/exit-flow (pre-existing + Sub 1-2)
- [x] AC 10: Field renamed defaultTools → savedTools
- [x] AC 11: Command base: specManager and toolRegistry are optional
- [ ] AC 12: InSessionAgent removed; SessionAgent extends Agent directly; ADR 0007 amended

## Subtask plan
- [x] Sub 1: SessionAgent re-entrancy guard + orphaned destroy guard
- [x] Sub 2: FlowExitCommand → destroyAgent + error resilience
- [x] Sub 3: Rename defaultTools → savedTools
- [x] Sub 4: Command base class — make specManager, toolRegistry optional
- [ ] Sub 5: Remove InSessionAgent + amend ADR 0007

## Decisions made this session
- Sub 1: mount() guard uses `savedTools.length === 0` check (not a stack)
- Sub 1: unmount() guard combined `this.pi && this.savedTools.length > 0`
- Sub 2: destroyAgent loop with Error[] collection + conditional notification
- Sub 2: test spies use call-through (vi.spyOn without mockImpl)
- Sub 4: base fields declared `?: SpecManager | undefined` / `?: ToolRegistry | undefined`; parameter order unchanged
- Sub 4: HeadlessFlowCommand drops specManager/toolRegistry from its own constructor and super() (supervisor/pi stay — base requires them)
- Sub 4: AgentListCommand/OrchestratorCommand got guard+notify for now-optional deps (ResearchCommand pattern); local const narrowing for closure usage
- Sub 4: WorktreeDestroyCommand/FlowExitCommand callers pass `undefined, undefined` placeholders to keep workspaceManager positional (order preserved per non-goal)

## Next action on resume
- Run build loop for Subtask 5: Remove InSessionAgent, make SessionAgent extend Agent directly, amend ADR 0007
