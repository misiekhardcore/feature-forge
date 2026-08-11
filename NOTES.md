# NOTES — user-modifiable-templates (#212)

## Current task

- Subtasks 1-5 done (skills move, forgeDir config, two-location lookup, forge-setup rewrite, ForgeInitCommand global prompt) — next: Subtask 6 (runtime loading from forgeDir)

## Task list / AC checklist

- [x] Move skills from repo-root `.forge/skills/` → `packages/cli/src/skills/`; add tsup copy step
- [x] Add `forgeDir` config field (default `".forge"`); defaults, accessor, TypeBox schema
- [x] Config loader two-location lookup — pointer config → real config merge
- [x] Rewrite `forge-setup.js` — scaffold agents/flows/skills; global vs local
- [x] Update `ForgeInitCommand.ts` — prompt "Store forge files globally (~/.forge)?"
- [ ] Update runtime loading — `index.ts` load from forgeDir, fail fast if not initialized
- [ ] Update `forge-skills.ts` — read forgeDir from config, contribute resolved path
- [ ] Update `skill-resolver.ts` — add forgeDir/skills to scan directories
- [ ] Validate — full lint/typecheck/test/e2e loop

## Subtask plan

### Subtask 1: Move skills + update tsup

- [x] Copy `.forge/skills/` → `packages/cli/src/skills/` (entire tree)
- [x] Add `skills` copy to tsup `onSuccess`: `cp src/skills → dist/skills`
- [x] Delete `.forge/skills/` from repo root
- [x] Update runtime discovery (SkillResolver + forge-skills extension) so bundled skills stay available after the move
- **Dependencies**: None

### Subtask 2: Add forgeDir to config schema

- [x] Add `forgeDir` TypeBox field to `ForgeConfigSchema`
- [x] Add `"forgeDir": ".forge"` to `forge-config.defaults.json`
- [x] Wire `forgeDir` through `createDefaultConfig()` and `resolveConfig()`
- [x] Add `getForgeDir()` accessor to `ForgeConfig` class (resolves `~` and relative paths)
- **Dependencies**: None

### Subtask 3: ConfigLoader two-location lookup

- [x] In `forRoot()`: when `.forge/config.json` has `forgeDir` pointing elsewhere, resolve real config from there
- [x] Merge project `.forge/config.json` overrides on top (strip `forgeDir` from merge)
- [x] Fallback: if no project `.forge/config.json`, try `~/.forge/config.json`
- [x] If neither exists, use defaults
- **Dependencies**: Subtask 2

### Subtask 4a: forge-setup: flags + dist resolution

- [x] Add `--global` and `--forge-dir <path>` flag parsing
- [x] Add `resolveDistDir()` helper to find package dist from script location
- [x] Restructure main() to route global vs local
- **Dependencies**: None (structural refactor of existing script)

### Subtask 4b: forge-setup: copy assets

- [x] Copy `dist/agents/declarative-specs/*.md` → `<forgeDir>/agents/` (flatten, one file per .md)
- [x] Copy `dist/flows/` → `<forgeDir>/flows/`
- [x] Copy `dist/skills/` → `<forgeDir>/skills/`
- **Dependencies**: Subtask 1 (skills in dist), Subtask 4a (dist resolution)

### Subtask 4c: forge-setup: config + gitignore

- [x] Global mode: write real config to `~/.forge/config.json`, pointer-only at `.forge/config.json`
- [x] Local mode: write full config at `.forge/config.json`
- [x] Global mode: skip gitignore entries entirely
- [x] Local mode: keep existing gitignore entries
- **Dependencies**: Subtask 2 (forgeDir field in config), Subtask 4a

### Subtask 5: Update ForgeInitCommand.ts

- [x] Add "Store forge files globally (~/.forge)?" confirmation prompt before existing prompts
- [x] Pass `--global` flag to setup script when user chooses global
- [ ] Pass `--forge-dir` to setup script
- **Dependencies**: Subtask 4a (flags exist), Subtask 4c (global config logic)

### Subtask 6: Update runtime loading — index.ts

- [ ] After `ForgeConfig.create()`, resolve `forgeDir` via `getForgeDir()`
- [ ] Check `<forgeDir>/agents/` exists; fail with "Forge not initialized" if not
- [ ] Load agent specs from `<forgeDir>/agents/` instead of `__dirname + "agents/declarative-specs"`
- [ ] Load flows from `[<forgeDir>/flows/, ...forgeConfig.getFlowDirectories()]` (remove built-in flows dir)
- **Dependencies**: Subtask 2 (getForgeDir accessor)

### Subtask 7: Update forge-skills.ts

- [ ] Read `forgeDir` from `ForgeConfig.getInstance().getForgeDir()`
- [ ] Resolve `<forgeDir>/skills/` and contribute via `resources_discover`
- [ ] Fall back to `.forge/skills/` if ForgeConfig not initialized
- **Dependencies**: Subtask 2

### Subtask 8: Update skill-resolver.ts

- [ ] Add optional `forgeDir` param to `resolvePaths()` and `discoverAll()`
- [ ] Scan `<forgeDir>/skills/` instead of hardcoded `.forge/skills/`
- [ ] Default to `.forge/skills` when forgeDir not provided (backward compat)
- [ ] Update callers to pass forgeDir from ForgeConfig
- **Dependencies**: Subtask 2

### Subtask 9: Final validation

- [ ] Run full lint/typecheck/test suite
- **Dependencies**: All previous subtasks

## Decisions made this session

- Dropped `.version` file (4c removed) — premature infrastructure with no consumer; migration feature will add it when needed (decision: user)

## Next action on resume

- Execute Subtask 6: runtime loading from forgeDir (`index.ts`) — resolve `getForgeDir()`, fail fast if not initialized, load specs/flows from `<forgeDir>/`
