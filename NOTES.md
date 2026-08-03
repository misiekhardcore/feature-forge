# NOTES — fix-forge-init-__dirname

## Current task
- Done — PR ready

## Task list / AC checklist
- [x] ForgeInitCommand.ts no longer uses bare __dirname -- it must define the ESM polyfill (import fileURLToPath from node:url, const __dirname = path.dirname(fileURLToPath(import.meta.url)))
- [x] Build passes (tsup bundles without error)
- [x] Lint and typecheck pass
- [x] Tests pass (1909 tests; e2e 60/60)
- [x] Compiled dist/index.js has its own __dirname variable for the ForgeInitCommand scope (no bare __dirname reference)

## Subtask plan
- [x] Add ESM polyfill to ForgeInitCommand.ts: import fileURLToPath from node:url, define __dirname module-level, build and validate

## Decisions made this session
- Added ESM polyfill to ForgeInitCommand.ts following the same pattern as index.ts (why: fix bare __dirname ReferenceError at runtime when /forge:init is invoked)

## Next action on resume
- Open PR with commit a672867a
