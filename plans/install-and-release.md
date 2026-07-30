# Plan: Extension Installation & Release Pipeline

## Goal

Ship feature-forge as a single installable npm package (`@feature-forge/cli`) with a guided project init flow. End state: `pi install npm:@feature-forge/cli`, then `/forge:init` (or `npx @feature-forge/cli init`) in any project.

## Decisions

| #   | Decision                                                                              |
| --- | ------------------------------------------------------------------------------------- |
| 1   | All workspace packages share root `package.json` version                              |
| 2   | `shared`/`tui`/`debug` bundled into `cli` at build time — never published separately  |
| 3   | Script at `packages/cli/scripts/forge-setup.sh`, shipped in npm tarball via `"files"` |
| 4   | Two entry points: pi command `/forge:init` + standalone `npx @feature-forge/cli init` |

---

## Phase 1 — Build Pipeline & Single-Package Publish

### 1.1 — Bundle internal workspace packages into `cli`

- [ ] Add build step to `packages/cli` that compiles `src/` + all `@feature-forge/*` workspace deps into `dist/`
  - Use tsup/esbuild: single entry `src/index.ts`, bundle all `@feature-forge/*` deps, externalize `@earendil-works/pi-*` and `@sinclair/typebox`
  - Output: `dist/index.js`
- [ ] Move `@feature-forge/*` from `dependencies` to `devDependencies` in `packages/cli/package.json` (build-time only)
- [ ] Update `packages/cli/package.json`:
  - `"main": "dist/index.js"`
  - `"pi": { "extensions": ["./dist/index.js"] }`
  - `"files": ["dist/", "scripts/", "defaults/"]`
- [ ] Root `package.json`: update `pi.extensions` to `["./packages/cli/dist/index.js"]` (for monorepo dev builds)

### 1.2 — Dependency alignment

- [ ] Move `@earendil-works/pi-*` from `dependencies` to `peerDependencies` with `"*"` range (pi bundles these)
- [ ] Move `@sinclair/typebox` to `peerDependencies` (pi bundles it)
- [ ] Keep `yaml` in `dependencies` (not bundled by pi, used by ConfigLoader)

### 1.3 — Mark non-publishable packages private

- [ ] `packages/eslint-config/package.json` — set `"private": true`
- [ ] `packages/web/package.json` — set `"private": true`

### 1.4 — Release workflow

Extend `.github/workflows/release.yml`:

- [ ] Add npm registry auth step (`NPM_TOKEN` — user adds secret, I'll flag when we reach this step)
- [ ] Add `npm run build` step before publish
- [ ] Single publish: `npm publish -w @feature-forge/cli --access public`
- [ ] Optionally: CHANGELOG `[Unreleased]` promotion/reopen pattern

### 1.5 — Test tarball

- [ ] `npm pack -w @feature-forge/cli` — verify `dist/`, `scripts/`, `defaults/` present, `src/` excluded
- [ ] `pi install ./feature-forge-cli-0.1.0.tgz` — verify extension loads, tools/commands/skills discovered

---

## Phase 2 — Install Script

### 2.1 — Location

`packages/cli/scripts/forge-setup.sh` — shipped in npm tarball.

### 2.2 — What it creates

| Resource             | Action                                             |
| -------------------- | -------------------------------------------------- |
| `.forge/logs/`       | `mkdir -p`                                         |
| `.forge/worktrees/`  | `mkdir -p`                                         |
| `.forge/config.json` | Copy from template if missing, warn if exists      |
| `.gitignore`         | Append forge entries if not present                |
| `.env`               | Optionally scaffold with `FORGE_WORKTREE_SYMLINKS` |

### 2.3 — `.gitignore` entries to append

```
# Feature Forge runtime
.forge/*
!.forge/skills/
!.forge/skills/**
coverage-single/

# pi coding agent runtime (symlinked per worktree)
.pi

# Environment overrides
.env
.env.local
```

Idempotent — checks each entry before appending.

### 2.4 — CLI

```
Usage: forge-setup.sh [--yes] [--no-config] [--no-gitignore] [--cwd <path>]
```

Exit: 0 = success, 1 = prereq fail, 2 = partial.

### 2.5 — Prerequisites

- [ ] `git` available, pwd inside a git repo
- [ ] `pi` installed, version >= minimum
- [ ] Node.js >= 22

### 2.6 — Config template

`packages/cli/defaults/forge.config.json`:

```json
{
  "logLevel": "info",
  "workspaceProvider": "git-worktree",
  "worktreeSymlinks": ["node_modules", ".env"],
  "specDirectories": { "flows": [], "agents": [] }
}
```

---

## Phase 3 — Standalone CLI (`npx`)

### 3.1 — Node.js wrapper

`packages/cli/bin/forge.js` — parses `init` subcommand, resolves `forge-setup.sh` path, spawns it, forwards exit code.

### 3.2 — Bin entry

```json
"bin": { "forge": "./bin/forge.js" }
```

User runs: `npx @feature-forge/cli init --yes`

---

## Phase 4 — `/forge:init` Pi Command

### 4.1 — Registration

Register in `packages/cli/src/index.ts`:

- `/forge:init` — "Initialize Feature Forge project scaffolding"
- Resolves `forge-setup.sh` at runtime relative to extension dir

### 4.2 — Interactive flow

1. Welcome notification
2. Prerequisite checks — report failures
3. `ctx.ui.confirm("Scaffold forge.config.json?")` — default yes
4. `ctx.ui.confirm("Add forge entries to .gitignore?")` — default yes
5. Execute script via `pi.exec("bash", [scriptPath, ...args])`
6. Summary notification
7. "Open forge session?" prompt

Same script called by both `/forge:init` and `npx ... init`.

---

## Phase 5 — Validation

### 5.1 — Local smoke test

- [ ] `npm run build` produces `packages/cli/dist/index.js`
- [ ] `npm pack -w @feature-forge/cli` produces valid tarball
- [ ] `pi install ../feature-forge/packages/cli/feature-forge-cli-0.1.0.tgz` in fresh project
- [ ] `/forge:init` — verify `.forge/` dirs, gitignore, config
- [ ] Extension tools/commands registered, forge flows execute

### 5.2 — CI/CD

- [ ] Release workflow: dispatch → bump → changelog → build → publish
- [ ] CI build job verifies bundled output

---

## Files Changed

| File                                      | Action                                                        |
| ----------------------------------------- | ------------------------------------------------------------- |
| `packages/cli/package.json`               | Add `bin`, `files`; update `main`, `pi.extensions`; move deps |
| `packages/cli/build.config.ts`            | New — bundler config                                          |
| `packages/cli/bin/forge.js`               | New — npx entry                                               |
| `packages/cli/scripts/forge-setup.sh`     | New — install script                                          |
| `packages/cli/defaults/forge.config.json` | New — config template                                         |
| `packages/cli/src/index.ts`               | Add `/forge:init` command                                     |
| `packages/eslint-config/package.json`     | Set `"private": true`                                         |
| `packages/web/package.json`               | Set `"private": true`                                         |
| `.github/workflows/release.yml`           | Add build + npm publish                                       |
| Root `package.json`                       | Update `pi.extensions` to dist path                           |
