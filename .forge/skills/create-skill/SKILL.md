---
name: create-skill
description: >
  Creates, extends, and persists reusable skills and tools out of recurring work.
  Use when a procedure repeats (the 2nd+ time you do a non-trivial multi-step task),
  you re-research a topic, commands, or gotchas you already solved, you spot a
  workflow the agent keeps re-deriving, or a session wrap-up reflection flags a
  skill opportunity. Covers dedup-first search (extend, never duplicate), project
  vs global scope decisions with confirmation gates, the house structure mandate
  (SKILL.md + references/ + optional scripts/), validation via skill_validate and
  persistence via skill_persist, and the skill-vs-custom-tool choice. NOT for
  one-off tasks with no repetition, knowledge/facts (those belong in the memory
  wiki or AGENTS.md), or deterministic logic that belongs in an extension tool.
---

# Create a Reusable Skill or Tool

You are the skill author. Turn recurring work into a well-scoped, well-structured,
validated skill - or a custom tool when the logic is deterministic - instead of
letting the same procedure be re-derived from scratch every time.

Follow the numbered workflow. Every step that produces a file ends with the
deterministic helpers: `skill_validate` (structure + frontmatter checks) and
`skill_persist` (scope-resolved placement + git handling).

## 1. When to create

Create or extend a skill when any of these triggers fires:

1. **Recurrence** - you are about to do a non-trivial multi-step task for the
   2nd+ time (same commands, same file layout, same decisions).
2. **Re-research** - you start re-deriving knowledge you already solved this
   session or before: exact commands, API shapes, config gotchas, ordering rules.
3. **Repeated orchestration** - a multi-tool sequence (read -> edit -> validate
   -> test) that you keep replaying with only the inputs changing.
4. **House conventions** - the project or user has rules agents keep getting
   wrong; a skill encodes them once with a trigger description.
5. **User signals** - "we always do X", "remember to Y", "make this reusable".
6. **Session wrap-up** - a session-end reflection (the forge agent_settled
   nudge) asks whether anything repeated; evaluate honestly, reply briefly.

Capture the procedure while it is fresh. A 10-minute investment now saves the
same 10 minutes every future occurrence.

## 2. When NOT to create

- **One-off work** - no repetition expected; a skill is dead weight.
- **Facts and knowledge** - "what/why" content belongs in the memory wiki
  (agents-memo) or `AGENTS.md`, not in a skill. Skills encode procedures
  (the HOW of recurring work).
- **Deterministic logic** - anything with typed inputs/outputs, filesystem or
  harness effects, or that must run reliably regardless of model should be a
  custom extension tool, not a skill with bash scripts. See section 7.
- **Duplication** - an existing skill already covers it: extend it instead.
- **Mid-flow disruption** - do not break the user's current task to build a
  skill. Note the pattern and create it at the wrap-up nudge or when asked.

## 3. Search first - dedup

1. **Check the session listing** - every skill name + description is listed in
   the system prompt at session start. Scan it for overlap.
2. **Grep the candidate homes** - targeted search of `~/.forge/skills`,
   `<repo>/.pi/skills`, `~/.pi/agent/skills`, and installed package skill dirs
   for the procedure's keywords.
3. **On overlap: extend, do not duplicate.** Fold the new procedure into the
   existing skill (add a section, refresh the description with new triggers).
   Rename or merge only with user consent.
4. **Never maintain a registry** - the startup listing IS the discovery
   surface. Dedup against it; no hand-maintained index.

## 4. Decide scope

Read `references/scoping.md` for the full rubric. The decision is three
questions: does it recur, who consumes it, which machines need it?

| Scope           | Location                                                  | Default?                                                                                                   |
| --------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Project         | `<repo>/.pi/skills/<name>/`                               | Default for repo-specific procedures. Commit with the current work - no confirmation needed.               |
| Global          | `~/.forge/skills/<name>/` (forge family, machine-local)   | Default for cross-repo/personal-infra capabilities. Always confirm with the user before writing.           |
| Global (synced) | `~/.pi/agent/skills/<name>/` (pi-config git repo)         | Alternative when the skill must sync across machines via pi-config. Always confirm with the user.          |
| Package         | bundled with a pi package (e.g. `<pkg>/core/src/skills/`) | For package audiences (agents-memo, feature-forge shape). Package owner drives this - not ad-hoc creation. |

Default to project. Promote to global only on demonstrated cross-repo need;
demote global skills that stay project-specific. Rules: **global writes always
require explicit user confirmation**; project skills are auto-committed with the
current work.

## 5. Structure mandate

Every skill must follow the house structure. Full guide:
`references/structure-guide.md`.

- `SKILL.md` under ~500 lines with valid frontmatter (`name`, trigger-rich
  `description`; both required by pi) and these body sections:
  Overview / When to use + exclusions / numbered workflow with explicit
  commands and I/O / Gotchas / Verification checklist.
- `references/` for supporting detail - one level deep, each file focused.
- `scripts/` only when deterministic logic is needed: JSON to stdout,
  diagnostics to stderr, `--help`, idempotent, never interactive.
- Omit empty directories. Prose uses hyphens, not em dashes.
- Start from `assets/SKILL.template.md` when scaffolding.

## 6. Author, validate, persist, report

1. **Scaffold** - create `<target>/<name>/SKILL.md` from the template; write
   the body sections; add references and scripts only when the procedure needs
   them.
2. **Write the description last-first**: it is the trigger. Lead with action
   verbs and the "Use when..." conditions; state the NOT-for exclusions;
   stay under 1024 characters.
3. **Validate** - call `skill_validate` with the skill path. Fix every finding
   (frontmatter, name rules, description, structure, script contract). Treat it
   as the deterministic gate - never report a skill as done while it fails.
4. **Persist** - call `skill_persist` with the target scope. It resolves the
   destination (`<repo>/.pi/skills` vs `~/.forge/skills` vs
   `~/.pi/agent/skills`), enforces the confirmation gate for global writes,
   and handles git for git-backed homes. For project scope it commits with the
   current work; for global scope it waits for the user's explicit yes.
5. **Report** - tell the user: what was created or extended, the exact path,
   how to invoke it (`/skill:<name>`), and when it activates (new skills are
   listed from the next session start; extensions activate via `/reload`).

## 7. Custom tool vs skill

Skills teach (progressive disclosure, model-executed). Tools do (typed schemas,
deterministic, harness-executed). One home per capability: **never duplicate
logic as both an extension tool and skill scripts.**

| Prefer a custom tool when                             | Prefer a skill when                              |
| ----------------------------------------------------- | ------------------------------------------------ |
| Typed inputs/outputs matter (TypeBox schema)          | The value is instruction: steps, order, criteria |
| Must run identically every time                       | The model must adapt the steps to context        |
| Needs harness guarantees: events, hooks, MCP, /reload | Reuses existing shell tools via `read`/`bash`    |
| Several flows share the operation                     | One workflow owns the procedure                  |

If an extension tool already exists for the capability, the skill becomes a thin
orchestrator over it - never a second implementation.

## Verification checklist

- [ ] Recurrence confirmed (trigger fired) - not a one-off
- [ ] Dedup done: no overlap with listed skills, no duplicate home
- [ ] Scope correct: project by default; global only with user confirmation
- [ ] Frontmatter valid: name rules, non-empty description under 1024 chars
- [ ] Structure mandate followed: sections, references depth, script contract
- [ ] `skill_validate` passed with zero findings
- [ ] `skill_persist` completed: right path, git state correct per scope
- [ ] User informed: path, invocation, activation timing
