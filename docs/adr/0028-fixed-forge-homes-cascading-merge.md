# ADR 0028: Fixed forge homes with cascading config and layered assets

**Date:** 2026-09-04
**Status:** Accepted (approved by the maintainer during design; implemented by issue #257)

## Supersedes

- **The `forgeDir` config-routing design.** Config no longer carries a
  `forgeDir` key or any pointer semantics: no pointer-vs-real-vs-fallback
  loader branches, no forge-setup pointer/backup/migration logic, no
  forgeDir-derived asset-home resolution. The runtime derives both homes
  from fixed locations (the project cwd and `os.homedir()`).
- **ADR 0012's config-discovery section** (section 7, "Config file
  location"). ADR 0012 documented `.forge/config.json` as the first path
  checked with the repo-root `forge.config.json` as a fallback. The
  repo-root fallback is removed and config location is no longer a
  single-file lookup - it is the two fixed homes merged over the packaged
  defaults (see Config cascade below). ADR 0012's model-preset decisions
  (sections 1-6) are unaffected.
- **The "forge skills load from the forge home only, no packaged
  fallback" rule** from the create-skill rollout. Packaged assets are a
  runtime default layer, not merely an init seed.
- **Citation correction:** that skills rule was previously cited as "ADR
  0015". This is wrong - ADR 0015 is the active-flow-registry ADR and
  never contained a skills-loading rule. The forgeDir-only skills rule
  lived in a forge-skills.ts comment and the create-skill design docs.
  The forge-skills.ts comment is corrected in this PR, and the create-skill
  scoping reference (`references/scoping.md`) now cites this ADR instead.
  Recorded here so future readers are not misled.

## Context

`forgeDir` as a config value caused a cascade of edge cases:

- **Config routing.** The loader had three branches (pointer file, real
  file, fallback) and forge-setup carried pointer/backup/migration logic
  to keep a project's `.forge/config.json` pointing at the real forge
  home.
- **Asset routing.** Projects with a scaffolded scope read their own
  `.forge` copies; the global home served uninitialized projects. Updates
  to shared skills or templates therefore reached some projects but not
  others - stale per-project snapshots were the default state, and there
  was no way to ship a bundled default to every project at once.
- **Init forked everything.** forge:init had to ask project-vs-global,
  and the answer changed every downstream lookup (which config file is
  authoritative, where assets come from).

The root cause chain is documented in the create-skill design session
(see History): forgeDir config routing, per-project scaffold staleness,
and the deployment matrix for bundled assets together made "one shared
forge, updated once" impossible. Issue #257 records the fix.

## Decision

Fixed locations plus a cascading merge. The runtime never asks where the
forge home is; it always layers the same fixed homes.

### D1 - Fixed homes, no config indirection

| Layer              | Config                         | Assets (agents, flows, skills)           |
| ------------------ | ------------------------------ | ---------------------------------------- |
| Project            | `<project>/.forge/config.json` | `<project>/.forge/{agents,flows,skills}` |
| Global             | `~/.forge/config.json`         | `~/.forge/{agents,flows,skills}`         |
| Default (packaged) | packaged defaults (extension)  | packaged assets (extension)              |

- There is no `forgeDir` key in the schema, in the defaults file, or in
  any scaffolded config. A leftover `forgeDir` key in an old config file
  still validates (the schema stays open - no
  `additionalProperties: false`) and is dropped at decode; the residual
  sweep strips such keys from known configs, but a stray key can never
  fail a load.
- The packaged assets root is resolved by a module-location probe for the
  marker dirs (`flows`, `skills`, `agents`): the built layout carries
  them in `packages/cli/dist` (tsup's onSuccess copies them), and the
  source/vitest layout resolves them under `packages/core/src`.

### D2 - The full flow (confirmed model)

1. The user initializes forge in a scope (global and/or project).
   forge:init copies the extension's files into the chosen home so the
   user has a working copy to modify. Scaffolding is additive and
   idempotent: template files skip existing destinations and
   `config.json` is written only when missing; existing configs and
   project files are never clobbered. Runtime directories
   (`.forge/logs`, `.forge/worktrees`) always stay project-local.
2. The user modifies files at either scope - that is why the copies
   exist.
3. Running forge in a project merges EVERYTHING, project to global to
   default: both configs and assets.
4. Per-item lookup for assets (skills / agents / flows): if the item is
   not in project scope, use global scope; if not there either, fall
   back to the packaged default in the extension.

Both a global init and project inits may coexist on one machine; every
project session respects both homes.

### D3 - Config cascade: per-top-level-key merge with whole-section replacement

`project config` merges onto `global config` merges onto `packaged
defaults`, with the `FORGE_*` env-var overlay staying top-most
(`defaults < global < project < env`). A missing layer is skipped -
absence of a file is an empty layer, and when neither file exists the
defaults (plus the env overlay) are returned. `${ENV_VAR}` references
are resolved inside both files before the merge.

The merge is **per top-level key with WHOLE-SECTION replacement for
nested sections** (`display`, `defaultAgent`, `agents`, `models`,
`specDirectories`). This is deliberate and test-pinned: a project file
that sets one key of a nested section replaces the global file's whole
section (e.g. a project `display.maxOverlayHeight` drops the global
file's other `display` keys). At the top level, a key the project file
omits falls back to the global file, and a top-level key both files omit
falls back to the packaged default - but nothing inside a nested section
is deep-merged across layers. Config authors should treat each nested
section as an atomic unit at each layer.

The same merge feeds config-declared `specDirectories` extras: their
relative entries resolve against the project cwd and are threaded into
the asset cascade below as the strongest layer.

### D4 - Asset cascade: ordered first-wins layers with claim-on-success

Agents and flows use one unified precedence rule: ordered first-wins
layer directories `[config specDirectories extras, project home, global
home, packaged]` - the nearest layer that declares an item claims it.

- **Extras are strongest** - explicitly configured directories beat
  inherited homes. This is a documented flip from the pre-cascade
  semantics: agent extras were previously additive-only (they were
  searched in addition to the homes, and their specs could not win), and
  flow extras previously won by last-write-wins across duplicate
  commands. One precedence rule now applies to all assets.
- **Agents** are claimed per spec id (`SpecManager` registers layer
  dirs in order; the first occurrence is kept).
- **Flows** are claimed per command name, keyed on the discovered
  directory name matching its `flow.json` name.
- **Skills, main session**: pi's own skill loader resolves the per-user
  and per-cwd pi-level dirs first (`~/.pi/agent/skills`, then
  `<cwd>/.pi/skills`), then the contributed paths from the
  `resources_discover` handler. `activateForgeSkills` contributes the
  layered `[project, global, packaged]` skill roots to that handler; per
  skill name, only the winning (nearest) layer's `SKILL.md` file path is
  contributed. Each layer root is scanned recursively for
  SKILL.md-bearing directories at any depth, so grouping directories
  (the bundled `review/*` family, or scaffolded copies of it) resolve
  like flat skill dirs; a directory that directly holds a SKILL.md is a
  skill root and is not descended into, mirroring pi's own loader
  rules. Pi's skill loader is first-seen-wins per name across all
  of these, so the result is exact nearest-wins precedence - pi-level
  dirs first, then project over global over packaged - with zero
  collision noise from the forge layers. Skill names come from the
  frontmatter `name`, falling back to the skill directory basename.
- **Skills, subagent resolver**: `SkillResolver` scans, in priority
  order, the per-user pi-level dirs (`~/.agents/skills`,
  `~/.pi/agent/skills`), then each threaded forge home's `skills/`
  subdirectory (the composition root threads `[projectHome, globalHome]`,
  nearest first, so project wins name collisions against global), then
  the bundled default skills as the lowest layer. Scans traverse
  grouping directories recursively (the bundled `review/*` family is a
  grouping dir with no direct SKILL.md), matching the main-session scan
  so subagent resolution and session discovery agree on nested layouts.

The cascade is claim-on-success and therefore self-healing: an item in a
nearer layer only claims its name when it is actually loadable (the
skill's SKILL.md parses a name, the spec file declares its id, the flow
directory names its command). A broken nearer-layer entry falls through
to deeper layers instead of shadowing them. Degraded mode (registering
only `/forge:init`) is reached only when no layer carries any agents -
and because the packaged defaults are nearly always present, a missing
project/global scaffold no longer degrades the extension.

### D5 - Known asymmetries and documented decisions

Recorded from the S4 review; these are intentional or accepted:

- **A skill whose name parses but whose `description` is missing
  shadows deeper valid copies.** Pi drops the malformed file silently,
  and the deeper copy was never contributed because the nearer layer
  already claimed the name.
- **Loose root-level `.md` skills under forge skills roots are not
  discovered in the main session** (dir-per-skill discovery only - a
  skill is a directory holding a SKILL.md, at any depth). The subagent
  resolver mirrors that split on its side: `~/.agents/skills` and
  forge-home `skills/` roots drop loose root-level `.md` files too
  (dir-per-skill discovery only), while only `~/.pi/agent/skills` scans
  root `.md` files (filename stem = skill name), mirroring pi's
  single-file handling in its own agent dir.
- **`forgeHomes` on the core `SkillResolver` API is a
  composition-root-only contract.** Callers that omit it get the legacy
  fallback of a single `.forge` home resolved against the cwd; only the
  composition root threads the real project/global homes.
- **The resolver does not scan pi's per-cwd `.pi/skills`.** A skill name
  present in both `.pi/skills` and a forge home can therefore resolve
  differently between the orchestrator session (whose discovery includes
  pi's own per-cwd dirs) and subagents (which go through the resolver).
- **Leftover `forgeDir` keys validate and drop silently** (open schema),
  so old configs keep loading; the sweep strips them where known.

## Consequences

- **Deploy story.** Bundled defaults reach every project through the
  packaged layer the moment the extension updates - a brand-new bundled
  skill or flow is available everywhere without any scaffolding.
  Project- and global-scope copies are the customization surface and are
  never pruned: per-project customizations win over global on collision,
  and `~/.forge` fills anything the project lacks and serves
  uninitialized projects.
- **Init is additive and idempotent.** Re-running forge:init never
  clobbers edited configs or project files; it only fills gaps.
  Existing project scaffolds (agents-memo, feature-forge, portfolio,
  terra-madera, and similar) are the per-project customization surface:
  users initialize forge in a project to tune skills/flows/agents to
  that repo.
- **Refreshing unedited scope copies stays an explicit act.** An
  unedited scope copy pins that scope to its own version until refreshed
  (project wins over the packaged default). The default refresh is
  explicit re-copy from the package; an open sub-question - a
  byte-identical-refresh heuristic that refreshes files still identical
  to the last shipped default while preserving user edits - is out of
  scope for #257.
- **The create-skill rollout completes.** All scaffolded homes plus the
  packaged default layer now guarantee skill availability everywhere,
  even without scaffolding.
- **No degraded extension on missing scaffold.** Because packaged
  defaults are a runtime layer, the extension degrades only when no
  asset layer exists at all.

## History

- The root-cause chain was documented in the create-skill design
  session: forgeDir config routing (pointer vs real), per-project
  scaffold staleness, and the deployment matrix for bundled assets.
- Design and review sessions (S1-S5) refined the model and pinned its
  edge semantics in tests: whole-section replacement (review C1), the
  unified extras-first precedence flip, per-name winning SKILL.md file
  contribution, packaged-root probing, and the residual-sweep tolerance
  for leftover `forgeDir` keys. Decisions were logged in the worktree
  NOTES.md.
- Implementation and this ADR land together as issue #257; the ADR draft
  at the repo root is folded into this file.
