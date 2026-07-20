# Plan to Fix Skill Collision and Implement Scoped Skill Loading

## Problem

- Skill name collision between `~/.agents/skills/build` (and `verify`) and `.forge/skills/build` (and `verify`) causes warnings on pi startup.
- Skills are loaded globally, not scoped to the worktree.
- No lazy loading of skills.

## Solution

Rename the skill directories and update references to avoid collisions, ensuring the feature-forge specific skills are used only within this workspace.

## Steps

### 1. Rename skill directories

- Move `.forge/skills/build` to `.forge/skills/forge-build`
- Move `.forge/skills/verify` to `.forge/skills/forge-verify`

### 2. Update skill names in SKILL.md files

- In `.forge/skills/forge-build/SKILL.md`, change the `name` field from `build` to `forge-build`
- In `.forge/skills/forge-verify/SKILL.md`, change the `name` field from `verify` to `forge-verify`

### 3. Update agent specifications to use the new skill names

- In `packages/cli/src/agents/declarative-specs/build.md`:
  - Change `skills:` list from `[ "build" ]` to `[ "forge-build" ]`
- In `packages/cli/src/agents/declarative-specs/verify.md`:
  - Change `skills:` list from `[ "verify" ]` to `[ "forge-verify" ]`

### 4. Update tests that reference the skill names

- In `packages/cli/src/loaders/SpecLoader.test.ts`:
  - In the test `"build.md spec resolves with correct skills, toolPreset, and ephemeral"`:
    - Update expected skills to `[ "forge-build" ]`
  - In the test `"verify.md spec resolves with correct skills, toolPreset, and ephemeral"`:
    - Update expected skills to `[ "forge-verify" ]`
- In `packages/cli/src/agents/SpecManager.test.ts`:
  - Check for any tests that reference the build or verify specs and update skill expectations if needed.

### 5. Run validation loop

- Run `npm run fix` to apply any automatic fixes.
- Run `npm run lint` to check for linting errors.
- Run `npm run typecheck` to ensure TypeScript compiles.
- Run `npm test` to ensure all tests pass.

### 6. Verify fix

- Start `pi` from this worktree and confirm that the skill collision warning no longer appears.
- Verify that the build and verify agents use the new skill names (optional: test by running an agent and checking that it loads the correct skill).

## Progress Tracking

- [ ] Step 1: Rename directories
- [ ] Step 2: Update SKILL.md files
- [ ] Step 3: Update agent specifications
- [ ] Step 4: Update tests
- [ ] Step 5: Run validation loop
- [ ] Step 6: Verify fix
