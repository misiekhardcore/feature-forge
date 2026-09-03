# Scoping Rubric - Where a Skill Lives

Placement decides reach, persistence, and git behavior. Decide with three
questions, then write. `skill_persist` implements this rubric - the questions
here mirror its decision logic.

## The three questions

1. **Does it recur beyond this repo?** Repo-only procedure -> project scope and
   stop. Cross-repo, personal-infra, or "I do this everywhere" -> global.
2. **Who consumes it?** A package's own agents and flows (agents-memo,
   feature-forge shape) -> package scope, owned by the package. Just this
   user's sessions -> project or global.
3. **Which machines need it?** One machine -> global default
   (`~/.forge/skills`). Many machines -> the synced global home
   (`~/.pi/agent/skills`, the pi-config git repo).

## Placement table

| Scope           | Location                                           | Persistence                                            | Git                             | Confirmation  |
| --------------- | -------------------------------------------------- | ------------------------------------------------------ | ------------------------------- | ------------- |
| Project         | `<repo>/.pi/skills/<name>/`                        | With the repo                                          | Commit with the current work    | None needed   |
| Global (forge)  | `~/.forge/skills/<name>/`                          | Machine-local; forge runtime reads this dir (ADR 0015) | Not a git repo                  | Required      |
| Global (synced) | `~/.pi/agent/skills/<name>/`                       | Machine-synced via the pi-config repo                  | `git add` + commit in pi-config | Required      |
| Package         | `<pkg>/.pi/skills/` or bundled `<pkg>/src/skills/` | With the package                                       | Package PR / release            | Package owner |

## Rules

- **Default to project.** The smallest scope that serves the need. Most
  procedures are repo-specific even when they feel universal.
- **Global writes always require explicit user confirmation.** The user owns
  the machine-global surface (`~/.forge/skills`, pi-config); never write there
  on your own. Project skills are committed with the current work without
  asking (they travel with the code that made them necessary).
- **One home per capability.** A procedure lives in exactly one place. Extend
  the existing home; never mirror a skill across homes. If two homes start to
  diverge, consolidate to the more general one.
- **Naming = dir name = skill `name`.** Lowercase, hyphens. Create the dir, do
  not spread files at a home's root.
- **Activation timing:** pi lists skills at session start - a new skill is
  visible from the next session (or `/reload`-adjacent skill refresh where
  supported). Extensions activate via `/reload`. Tell the user when it goes
  live.

## Promotion and demotion

Promote (project -> global) only on demonstrated cross-repo need: the same
procedure shows up in a 2nd repo, or the user asks to reuse it elsewhere.
Demote (global -> project) when a global skill has been used by exactly one
repo for a while - move it down and delete the global copy. Both moves need
user consent; `skill_persist` performs them with the confirmation gate.

## Global destination: forge vs pi-config

- `~/.forge/skills` - default for capabilities created from a forge context:
  they belong to the forge family and load in every session on this machine.
- `~/.pi/agent/skills` - use when the skill must reach other machines through
  pi-config. Prefer this only for genuinely cross-machine personal tooling;
  pi-config is a git repo, so content there is versioned and reviewable.

When in doubt, the rubric says: project first, global-forge when cross-repo on
this machine, global-pi-config when cross-machine, package when the audience is
a package's flows.
