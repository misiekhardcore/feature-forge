# Structure Guide - House Mandate for Skills

The authoritative format for every skill created or extended. Follow it exactly;
`skill_validate` checks conformance and reports findings.

## Skill layout

```
<name>/                  # one dir per skill; dir name = skill name
  SKILL.md               # required: frontmatter + instructions
  references/            # optional: supporting detail, ONE level deep
    <topic>.md           #   no nested subdirs
  scripts/               # optional: deterministic logic only (see below)
  assets/                # optional: templates, fixtures the skill references
```

- Omit empty directories - an empty `scripts/` or `references/` is noise.
- Keep the whole skill readable: `SKILL.md` under ~500 lines. When a section
  threatens that, move detail into `references/` and summarize in place.

## SKILL.md frontmatter

Per the Agent Skills spec as implemented by pi:

| Field | Required | Notes |
| ----- | -------- | ----- |
| `name` | Yes | Lowercase a-z, 0-9, hyphens; 1-64 chars; no leading/trailing/consecutive hyphens. Use the dir name. |
| `description` | Yes | Under 1024 chars. The model's only trigger - make it specific. |
| `license` / `compatibility` / `metadata` / `allowed-tools` / `disable-model-invocation` | No | Optional per spec. `disable-model-invocation: true` hides the skill from the system prompt (user invokes via `/skill:name`). |

- Unknown frontmatter fields are ignored by pi - do not rely on them.
- Name and description are validated at load: a skill without a non-empty
  `description` is not loaded.

### Description best practices

The description decides when the model loads the skill. Lead with action verbs,
then the "Use when..." conditions with concrete keywords, then the NOT-for
exclusions.

Good: "Validates skill structure per the house mandate. Use when a skill was
created or edited and needs a deterministic gate before persistence."

Poor: "Skill validation."

## SKILL.md body sections

Order the body as:

1. `# <title>` - what the skill produces.
2. **Overview** - 2-4 lines: the job, the shape of the procedure.
3. **When to use + exclusions** - concrete triggers AND the "do not use for..."
   list. Both are load-bearing; the exclusion list prevents misuse.
4. **Numbered workflow** - every step with explicit commands, exact file paths,
   input/output contracts. The model executes this - it must not have to guess.
5. **Gotchas** - the failure modes, ordering traps, and edge cases learned from
   real usage.
6. **Verification checklist** - checkbox list the agent runs before reporting
   done.

Keep prose imperative, terse, and specific. House style: hyphens, not em dashes.

## references/ rules

- One level deep only: `references/<topic>.md`.
- One focused topic per file, named by topic (e.g. `scoping.md`, `api.md`).
- Reference files from `SKILL.md` with relative links, e.g.
  `Read references/scoping.md for the full rubric.`
- Pull a reference into the main file only when it earns a permanent section.

## scripts/ contract

Scripts exist only when the procedure needs deterministic leaf logic that the
model should not improvise. The skill then orchestrates: read inputs, run the
script, act on its output.

- **JSON to stdout** - machine-readable results on stdout (single JSON doc).
- **Diagnostics to stderr** - logs, warnings, human noise never pollute stdout.
- `--help` supported; every invocation path documented in the skill.
- **Idempotent** - safe to re-run; no hidden state.
- **Never interactive** - no prompts, no TTY waits. Agents cannot answer.
- Exit codes: 0 success, non-zero failure with a stderr explanation.

## Assets

Templates and fixtures the skill references. Point to them from the workflow
(`Start from assets/SKILL.template.md`). Keep them small and copy-able.

## Self-check before persisting

- [ ] frontmatter parses: `name` valid, `description` non-empty, under 1024
- [ ] body has all six sections, in order
- [ ] `SKILL.md` under ~500 lines; heavy detail moved to references
- [ ] references one level deep; scripts honor the contract; no empty dirs
- [ ] description is trigger-first with concrete keywords and NOT-for exclusions
- [ ] prose uses hyphens, not em dashes
