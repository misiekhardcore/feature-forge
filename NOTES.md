# NOTES — review-findings-pr-215

## Current task

- All 7 review findings implemented and validated; PR #215 ready for re-review

## Task list / AC checklist

- [x] Fix 1 — scaffolded skills win over bundled copies (forge-skills.ts)
- [x] Fix 2 — forge:init non-destructive template scaffolding (forge-setup.js)
- [x] Fix 3 — global init must not clobber project config (forge-setup.js)
- [x] Fix 4 — global mode still gitignores runtime dirs (forge-setup.js)
- [x] Fix 5 — missing pointer target config must not kill extension (ConfigLoader.ts + index.ts)
- [x] Fix 6 — forge-setup fails loudly on missing agents assets (forge-setup.js)
- [x] Fix 7 — merge duplicate JSDoc blocks (ConfigLoader.ts)
- [x] Full validation + build + Fix 1 acceptance check

## Subtask plan

- [x] Setup: fetch + rebase origin/main, NOTES.md checkpoint
- [x] Implement fixes 1–7, one conventional commit each
- [x] Run npm run fix / lint / typecheck / test
- [x] Run turbo build --filter=@feature-forge/cli --force, run acceptance check

## Decisions made this session

- Kept appendGitignore as a shared entries helper with two no-arg wrappers so main stays `useGlobal ? appendGlobalGitignore() : appendGitignore()` (why: matches the spec'd invocation)
- For Fix 3, migration/backup logic runs before scaffoldConfig so a migrated config prevents the defaults write (why: scaffoldConfig only writes when target is missing)
- registerDegradedMode closes over `pi` rather than taking it as a param (why: no extra type import needed; missing-agents notice text stays byte-identical)
- Added `Logger.resetForTest()` to the degraded-mode afterEach (why: earlier tests leak a FileLogger whose getLogLevel needs ForgeConfig, which the config-failure test destroys)
- Acceptance check confirmed skill:forge-build resolves to `~/.forge/skills/forge-build/SKILL.md`, not the bundled dist copy

## Next action on resume

- Nothing pending — hand off for verify/review
