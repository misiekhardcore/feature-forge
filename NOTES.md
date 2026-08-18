# NOTES — pr225-review-thread-fixes

## Current task
- Validation green; commit (do not push)

## Task list / AC checklist
- [x] R1 add `flow:validate:all` script to packages/cli/package.json; ci.yml uses it
- [x] R2 remove redundant `**/*.test.ts` from vitest.config.ts coverage exclude
- [x] R3 move deepFreeze + clone helpers from ForgeConfigDefaults.ts → packages/shared/src/helpers/
- [x] Validation loop green (fix/lint/typecheck/test; coverage branches 91.18% >= 90%)
- [ ] Commit with conventional message (do NOT push)

## Decisions
- R4 ("why do we do this?") = reply-only (explain 3.21 rationale)
- Keep test-setup.ts / test-utils.ts / e2e / debug coverage exclusions (they are the real harness-code exclusions)
- R3: helpers live in src/helpers/freeze.ts; ForgeConfigDefaults imports from ../helpers and re-exports deepFreeze (ForgeConfig.ts untouched)
- R1: `flow:validate:all` = `npx tsx scripts/validate-flow.ts --all` (CI command semantics unchanged — same args, same script)
- Note: local `flow:validate:all` still fails under Node 25 (pre-existing tsx type re-export issue, identical to old `flow:validate -- --all`; CI runs Node 22)

## Next action
- git add -A && git commit -m "refactor: move freeze/clone helpers to shared, add flow:validate:all, drop redundant coverage exclude" (do NOT push)
