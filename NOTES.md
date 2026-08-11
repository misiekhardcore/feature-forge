# NOTES — user-modifiable-templates (#212)

## Current task

- Final validation (Subtask 9)

## Task list / AC checklist

- [x] Move skills from repo-root `.forge/skills/` → `packages/cli/src/skills/`; add tsup copy step
- [x] Add `forgeDir` config field (default `".forge"`); defaults, accessor, TypeBox schema
- [x] Config loader two-location lookup — pointer config → real config merge
- [x] Rewrite `forge-setup.js` — scaffold agents/flows/skills; global vs local
- [x] Update `ForgeInitCommand.ts` — prompt "Store forge files globally (~/.forge)?"
- [x] Update runtime loading — `index.ts` load from forgeDir, fail fast if not initialized
- [x] Update `forge-skills.ts` — read forgeDir from config, contribute resolved path
- [x] Update `skill-resolver.ts` — add forgeDir/skills to scan directories
- [ ] Validate — full lint/typecheck/test/e2e loop

## Decisions made this session

- Dropped `.version` file — premature infrastructure with no consumer; migration feature will add it when needed (decision: user)
- Merged 4a+4b into one commit (flag parsing + template scaffolding) since they were tightly coupled
- Subtask 5 was already implemented by a prior build loop attempt

## Next action on resume

- Run final validation (Subtask 9) then open PR
