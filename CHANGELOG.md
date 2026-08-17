# Changelog

All notable changes to this project are documented in this file.

## [0.3.0] - 2026-08-17

### Bug Fixes

- Bump workspace packages and stage them in release workflow
- Silent JSON retry loop causes false failures and display errors (#214)
- Exclude skill markdown from prettier to preserve minified style
- Contribute only forge-dir skills, drop bundled fallback
- Execute spawn_agent initial prompt in background (#216)
- Reuse the agent viewer overlay instead of stacking duplicates (#222)

### Chores

- Migrate plan docs to .forge/plans
- Release v0.3.0

### Documentation

- Plan uniform flow orchestration (eliminate headless flow path)

### Features

- User-modifiable built-in agents, flows, and skills via forge:init scaffolding (#212) (#215)
- Uniform flow orchestration — eliminate the headless flow path (#217)
- Flow orchestration hygiene — B1/B2/B3/B7/B9/B10 + D1/D3/D5 (#218)
- Uniform flow orchestration — presentation: B4/B5/B6 + C1/C3/C5 + D2/D4/D6 (#219)
