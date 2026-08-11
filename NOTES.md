# NOTES — user-modifiable-templates (#212)

## Current task
- Starting Subtask 1: Move skills + update tsup

## Task list / AC checklist
- [ ] Move skills from repo-root `.forge/skills/` → `packages/cli/src/skills/`; add tsup copy step
- [ ] Add `forgeDir` config field (default `".forge"`); defaults, accessor, TypeBox schema
- [ ] Config loader two-location lookup — pointer config → real config merge
- [ ] Rewrite `forge-setup.js` — scaffold agents/flows/skills; global vs local
- [ ] Update `ForgeInitCommand.ts` — prompt "Store forge files globally (~/.forge)?"
- [ ] Update runtime loading — `index.ts` load from forgeDir, fail fast if not initialized
- [ ] Update `forge-skills.ts` — read forgeDir from config, contribute resolved path
- [ ] Update `skill-resolver.ts` — add forgeDir/skills to scan directories
- [ ] Validate — full lint/typecheck/test/e2e loop

## Subtask plan

### Subtask 1: Move skills + update tsup
- [ ] Copy `.forge/skills/` → `packages/cli/src/skills/` (entire tree)
- [ ] Add `skills` copy to tsup `onSuccess`: `cp src/skills → dist/skills`
- [ ] Delete `.forge/skills/` from repo root
- **Dependencies**: None

### Subtask 2: Add forgeDir to config schema
- [ ] Add `forgeDir` TypeBox field to `ForgeConfigSchema`
- [ ] Add `"forgeDir": ".forge"` to `forge-config.defaults.json`
- [ ] Wire `forgeDir` through `createDefaultConfig()` and `resolveConfig()`
- [ ] Add `getForgeDir()` accessor to `ForgeConfig` class (resolves `~` and relative paths)
- **Dependencies**: None

### Subtask 3: ConfigLoader two-location lookup
- [ ] In `forRoot()`: when `.forge/config.json` has `forgeDir` pointing elsewhere, resolve real config from there
- [ ] Merge project `.forge/config.json` overrides on top (strip `forgeDir` from merge)
- [ ] Fallback: if no project `.forge/config.json`, try `~/.forge/config.json`
- [ ] If neither exists, use defaults
- **Dependencies**: Subtask 2

### Subtask 4a: forge-setup: flags + dist resolution
- [ ] Add `--global` and `--forge-dir <path>` flag parsing
- [ ] Add `resolveDistDir()` helper to find package dist from script location
- [ ] Restructure main() to route global vs local
- **Dependencies**: None (structural refactor of existing script)

### Subtask 4b: forge-setup: copy assets
- [ ] Copy `dist/agents/declarative-specs/*.md` → `<forgeDir>/agents/` (flatten, one file per .md)
- [ ] Copy `dist/flows/` → `<forgeDir>/flows/`
- [ ] Copy `dist/skills/` → `<forgeDir>/skills/`
- **Dependencies**: Subtask 1 (skills in dist), Subtask 4a (dist resolution)

### Subtask 4c: forge-setup: config + gitignore
- [ ] Global mode: write real config to `~/.forge/config.json`, pointer-only at `.forge/config.json`
- [ ] Local mode: write full config at `.forge/config.json`
- [ ] Global mode: skip gitignore entries entirely
- [ ] Local mode: keep existing gitignore entries
- **Dependencies**: Subtask 2 (forgeDir field in config), Subtask 4a

### Subtask 5: Update ForgeInitCommand.ts
- [ ] Add "Store forge files globally (~/.forge)?" confirmation prompt before existing prompts
- [ ] Pass `--global` flag to setup script when user chooses global
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
- Execute Subtask 1: run_build_loop for move skills + update tsup
