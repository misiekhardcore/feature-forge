---
name: <skill-name>
description: >
  <2-4 sentence trigger description. Action verb first, then "Use when..." with
  concrete keywords (commands, file types, failure symptoms), then the NOT-for
  exclusions. Under 1024 chars. Rewrite this LAST - it is the trigger.>
---

# <Title - the deliverable, e.g. "Scaffold a Widget" or "Triage CI Failures">

<Overview: 2-4 lines. What job this skill does, for whom, and the shape of the
procedure. The model reads this when deciding to continue after the trigger.>

## When to use

- <concrete trigger 1: "User asks to..." / "A <thing> needs <verb>">
- <concrete trigger 2>
- <concrete trigger 3>

## When NOT to use

- <exclusion 1 - what looks close but is a different job>
- <exclusion 2 - the boundary case>

## Workflow

1. **<Step name>** - what to do, why, and the exact command or file to touch.

   ```bash
   <explicit command with real flags - never "fill this in">
   ```

2. **<Step name>** - input -> action -> expected output. State the contract:
   what this step produces and what the next step consumes.
3. **<Step name>** - ...
4. **Verify** - the deterministic gate: run <check command / validation tool>,
   fix findings, do not skip.

## Gotchas

- <failure mode 1 learned from real usage: symptom -> cause -> fix>
- <ordering trap or edge case>

## Verification checklist

- [ ] <check 1 - run and observed>
- [ ] <check 2 - artifact at the documented path>
- [ ] <check 3 - deterministic gate passed with zero findings>
- [ ] <report line: user informed of path/invocation/activation>

<!--
Authoring notes (delete before persisting):
- Frontmatter: name lowercase-hyphen, must match the directory name.
- Keep SKILL.md under ~500 lines; move depth to references/<topic>.md.
- scripts/ only for deterministic logic: JSON to stdout, diagnostics to
  stderr, --help, idempotent, never interactive.
- One home per capability: search existing skills first and extend on overlap.
- Prose uses hyphens, not em dashes. Omit empty directories.
-->
