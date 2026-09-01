---
name: forge-livetest
description: >
  Live pi-session validation of the feature-forge extension. Use when unit/e2e
  tests cannot reach a behavior: session hooks (sessionId attribution),
  startup reconciliation after crashes, corrupt-file resilience, or any
  composition-root wiring. Boots a real headless pi process against a built
  extension bundle.
---

# Forge Live-Test Skill

Unit and e2e suites build the composition chain directly (RoutineExecutor +
real git repo) but never boot the real extension: they do not fire
`session_start` / `before_agent_start` hooks, do not run `reconcileAndLog` at
startup, and never load `cli/src/index.ts` as pi loads it. When a change
touches those paths, validate in a real pi session.

## When to use

- Changes to `packages/cli/src/index.ts` (extension composition root, hooks,
  startup wiring).
- `WorktreeRegistry` persistence format, load/corrupt-file policy, or
  reconciliation behavior.
- Any new `pi.on(...)` hook or `ExtensionAPI` usage.

## Prerequisites

- `pi` on PATH with an authenticated model provider (the headless run is a
  real LLM session).
- A buildable checkout: `npm run build` must work (tsup bundles
  `packages/cli/dist/index.js`).
- `node` >= 20.

## Quick start

```bash
# Build the current checkout and test it live
npm run build
node .forge/skills/forge-livetest/test-worktree-registry-live.mjs

# Test a specific branch (builds it in a temp worktree first)
node .forge/skills/forge-livetest/test-worktree-registry-live.mjs --branch forge/ws-worktree-registry

# Inspect what the pi sessions are doing
node .forge/skills/forge-livetest/test-worktree-registry-live.mjs --verbose --keep
```

## What it verifies

1. **Session attribution** - a headless pi session calls `create_workspace`;
   asserts `.forge/worktrees.json` is the v1 envelope `{version:1, worktrees}`,
   entries carry non-empty `path`/`branch`, and `sessionId` was stamped by the
   live `session_start` hook (UUIDv7).
2. **Crash-resume reconciliation** - removes the worktree dir + branch (crash
   leftovers), restarts pi, asserts the startup log contains the
   `reconciliation found issues` warning with `staleRegistryEntries`.
3. **Corrupt-file resilience** - writes garbage to `.forge/worktrees.json`,
   restarts pi, asserts the extension loads (exit 0), the log warns
   `starting with an empty registry`, and the registry starts empty.

## Manual scenario (when the script is not enough)

```bash
# 1. Build and load the PR branch's extension in isolation
pi -p -ne -e /path/to/packages/cli/dist/index.js --model <provider/model> \
  --thinking low "Use the create_workspace tool with no arguments."

# 2. Inspect the persisted registry
cat .forge/worktrees.json        # expect {version:1, worktrees:[{..., sessionId}]}

# 3. Simulate a crash and restart
rm -rf .forge/worktrees/<id> && git worktree prune && git branch -D forge/<id>
pi -p -ne -e /path/to/dist/index.js --model <provider/model> --thinking low "hi"
tail .forge/logs/forge-*.log     # expect reconciliation warning

# 4. Corrupt the file and restart (must NOT brick)
echo 'garbage' > .forge/worktrees.json
pi -p -ne -e /path/to/dist/index.js --model <provider/model> --thinking low "hi"
tail .forge/logs/forge-*.log     # expect "starting with an empty registry"
```

## Troubleshooting

- **`setSessionIdProvider is not a function` at load** - the bundle was built
  against the wrong core. A plain `node_modules` symlink to the main repo
  resolves `@feature-forge/core` to main's copy; use the script's `--branch`
  mode (node_modules mirror) or rebuild with correct links.
- **Extension fails to load in `-p` mode** - run with `-ne -e <dist>` so the
  settings-loaded (stale) extension is not also registered.
- **Scenario 1 flaky** - the model may call `create_workspace` with arguments
  or refuse; retry, or run with `--verbose` to see what it did. Assertions are
  on filesystem effects, so retries are safe (scratch repo is fresh each run).
- **No logs** - `ForgeConfig` writes `.forge/logs/` only when logging is
  initialized; check `logLevel` in `.forge/config.json` of the scratch repo
  (scaffolded from the repo's own config).

## Why this skill exists (self-tooling pattern)

Live behaviors (session hooks, startup reconciliation, corrupt-file load) are
invisible to unit and e2e suites, which construct the composition chain
directly. The first time they were validated (PR #247), the session had to
manually boot pi headlessly, scaffold a scratch repo, and inspect
`.forge/worktrees.json` + logs across three runs. That experience was
packaged into this skill + its script so the validation is one command and
repeatable.

**Pattern for future work:** when a task requires validating behavior the
test suite cannot reach (real process, hooks, external tool, timing), build
a self-tool - a script plus a skill that documents when/how to run it - and
commit both together. Keep the script next to its skill (this directory), not
in `packages/`, so the skill owns its tooling. Mirror the eslint/prettier
treatment: `.forge/` is runtime scaffold, not lint target (see root
`eslint.config.js` / `.prettierignore`). The script's assertions should be on
deterministic filesystem/process effects, never on LLM output text.
