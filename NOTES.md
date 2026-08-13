# NOTES — user-modifiable-templates (#212)

## Current task

- Done: all subtasks complete, PR #215 open, user e2e-tested

## Task list / AC checklist

- [x] Move skills from repo-root `.forge/skills/` → `packages/cli/src/skills/`; add tsup copy step
- [x] Add `forgeDir` config field (default `".forge"`); defaults, accessor, TypeBox schema
- [x] Config loader two-location lookup — pointer config → real config merge
- [x] Rewrite `forge-setup.js` — scaffold agents/flows/skills; global vs local
- [x] Update `ForgeInitCommand.ts` — prompt "Store forge files globally (~/.forge)?"
- [x] Update runtime loading — `index.ts` load from forgeDir, fail fast if not initialized
- [x] Update `forge-skills.ts` — read forgeDir from config, contribute resolved path
- [x] Update `skill-resolver.ts` — add forgeDir/skills to scan directories
- [x] Validate — full lint/typecheck/test/e2e loop

## Decisions made this session

- Dropped `.version` file — premature infrastructure with no consumer; migration feature will add it when needed (decision: user)
- Merged 4a+4b into one commit (flag parsing + template scaffolding) since they were tightly coupled
- Subtask 5 was already implemented by a prior build loop attempt
- **Degraded mode instead of fail-fast throw** — pi discards the whole extension when the factory throws, so /forge:init could never be registered to fix the missing scaffold. Load with only /forge:init registered + session_start notice, skip heavy setup
- **resolveAssetsDir()/resolveDefaultsPath() scan all three layouts** (scripts/, dist/, src/) — e2e testing exposed silent scaffolding skips in the published-package layout

## E2E verified by user

- Fail-fast path (before degraded mode): extension load error surfaced
- Degraded mode: extension loads, /forge:init available, notice shown
- forge:init scaffolds agents/flows/skills in both local and global mode
- forge:init:1/:2 duplication is a test-env artifact (global settings load main checkout alongside worktree) — accepted by user

## Next action on resume

- Await PR review; apply feedback via apply_feedback if any
