# Plan: `create-skill` - opportunistic skill/tool creation, shipped in feature-forge

Status: draft for discussion (2026-09-02 session). Living doc - edit here, implement after review.

## 1. Goal

A meta-skill, `create-skill`, that makes agents routinely turn recurring
problems/workflows into reusable artifacts (skills with scripts + references, or
real tools when warranted), structured consistently and placed at the right scope
(project vs global vs package).

Hosted in **feature-forge** (not pi-config): skill + template + references ship as
a forge skill; tools and the session-end nudge ship in the forge cli pi extension.
Rationale: feature-forge is already a globally loaded pi package on this machine,
already manages a skills tree + skill resolution for its agents, and its purpose
(autonomous software engineering) covers agent self-improvement. No new package,
no new global install surface.

## 2. Research summary (source list)

Web:

- Agent Skills spec (agentskills.io): frontmatter fields, dir conventions,
  progressive disclosure stages, <500 lines SKILL.md.
- Anthropic engineering + Claude Code docs/blogs: skills = procedures not facts;
  gotchas are highest-signal; descriptions written for the model trigger; scripts
  exist so the model composes instead of reconstructing.
- OpenAI Codex docs: scope table (repo/user/admin/system), description truncation.
- addyosmani/agent-skills anatomy: section layout incl. anti-rationalization
  tables, shared-references tradeoffs.
- Microsoft agent-framework: 4-stage disclosure (advertise/load/read/run).

Local (pi + feature-forge + disk):

- pi docs/skills.md, extensions.md, packages.md, sdk.md.
- feature-forge: AGENTS.md, packages/cli/src/index.ts, forge-skills.ts
  (resources_discover contribution), ForgeInitCommand + forge-setup.js
  (skill scaffold), packages/core/src/tools/Tool.ts + IpcTool, ToolRegistry,
  SpawnAgentTool (house pattern), packages/core/src/skills (bundled defaults).
- Disk: anatomy of ~40 installed skills; turnstile-spin, cloudflare-email-service,
  vault-ops, memo-autoresearch as reference architectures.

## 3. Decisions agreed so far

1. Skill vs tool boundary + 6-layer architecture (memory -> skill -> scripts ->
   sub-agents -> tools -> events/MCP). Route to the top-most sufficient layer.
2. Name: `create-skill`, user-invocable + model-invoked via trigger-rich description.
3. Structure mandate (enforced by template + structure guide): SKILL.md < ~500
   lines; frontmatter name + trigger-first description; body Overview / When to
   use + exclusions / numbered workflow / Gotchas / Verification; references/ one
   level deep; scripts JSON-out/stderr-diagnostics/--help/idempotent/no prompts;
   omit empty dirs; say run vs read.
4. Autonomy: project-scoped skills auto-created + committed with the task's work;
   global writes always confirmed with the user first.
5. Dedup: no hand-maintained registry. Pi lists every skill name+description in
   the system prompt at startup; dedup against that + targeted grep of candidates;
   extend on overlap. Future index must be script-derived, never hand-maintained.
6. No `scripts/validate-skill.sh` in v1 - requirements from first real usage.
   If the extension ships tools, validation logic lives in the tool, not a script.

## 4. Feature-forge integration map

| Piece                  | Home in feature-forge                                                       | Mechanism                                                                                                                                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Skill bundle           | `packages/core/src/skills/create-skill/` (SKILL.md + references/ + assets/) | forge-setup.js scaffolds it into forgeDir/skills; forge-skills.ts contributes forgeDir skills via `resources_discover` every session                                                                                                                               |
| Tools                  | `packages/cli/src/tools/SkillValidateTool.ts`, `SkillPersistTool.ts`        | `Tool` base class (core, pi-native signature), TypeBox schema, snake_case name, registered in index.ts via toolRegistry (plain Tool, not IpcTool - no agent IPC)                                                                                                   |
| Nudge                  | `packages/cli/src/extensions/skill-nudge.ts`                                | `pi.on("agent_settled")`, once-per-session latch, root session only (`FORGE_PARENT_SOCKET` guard), `ctx.hasUI` guard, real user message (`pi.sendUserMessage`) - agent reflects in context and may self-trigger /skill:create-skill; reply constrained to one line |
| Init-context injection | `packages/cli/src/extensions/forge-init-context.ts`                         | agents-memo INIT.md pattern: `before_agent_start` persistent message, session-scoped latch (once per first prompt), re-inject on session_compact, root session only. Content: forge capability notice + create-skill policy                                        |
| deliverAs bugfix       | `SessionAgent.mount()` + `FlowExitCommand` + audit                          | `pi.sendUserMessage` without `deliverAs` while agent is active drops/throws the message (docs: streaming requires steer/followUp). Fix: `{ deliverAs: "followUp" }` + regression tests                                                                             |

Key integration facts:

- ADR-0015: runtime reads forgeDir/skills only, never the bundled copy -> after
  merging the skill into the repo, deploy to `~/.forge/skills/create-skill/`
  (re-run forge:init or copy) for immediate effect on this machine.
- feature-forge loads as a global user package -> skill+tools reach every pi
  session on machines where feature-forge is installed. NOT synced via pi-config.
  Confirm this reach model is intended (alternative: also mirror skill to
  pi-config/agent/skills for machine sync - reject or accept in discussion).
- feature-forge AGENTS.md: OOP classes (no free functions as module surface),
  tests near code, worktree-based changes, ADR for new cross-package abstraction,
  validation loop (fix, lint, typecheck, test) with verbatim output evidence.

## 5. Deliverables

```
feature-forge/
├── packages/core/src/skills/create-skill/
│   ├── SKILL.md                     # trigger + opportunity detection + scope decision + lifecycle
│   ├── references/
│   │   ├── structure-guide.md       # full anatomy: frontmatter, sections, disclosure thresholds,
│   │   │                            #   script design rules, pi placement
│   │   └── scoping.md               # scope rubric + promote/demote + feature-forge reach model
│   └── assets/
│       └── SKILL.template.md        # copy-paste skeleton
├── packages/cli/src/tools/
│   ├── SkillValidateTool.ts         # deterministic exit criteria: frontmatter parses, name rules,
│   │                                #   body limits, no empty dirs
│   ├── SkillPersistTool.ts          # scope resolution (project .pi/skills vs forge/pi-config global),
│   │                                #   correct git repo detection, global-confirm gate
│   └── *.test.ts                    # tests near code (house rule)
├── packages/cli/src/extensions/
│   ├── skill-nudge.ts               # agent_settled -> once/session prompt, child-agent guard
│   └── skill-nudge.test.ts
└── packages/cli/src/index.ts        # wire tool registry + activateSkillNudge (edit)
```

Deployed (this machine, after merge): `~/.forge/skills/create-skill/`.

Optional follow-ups (not v1):

- skill_search tool (structured catalog across global/project/package/vendor dirs)
  - medium value; revisit when dedup greps get slow.
- Cross-harness copy (.claude/skills/create-skill) - format is the open spec.

## 6. Implementation steps (feature-forge discipline)

0. Standalone bugfix PR first: deliverAs fix (SessionAgent.mount, FlowExitCommand,
   audit remaining sendMessage sites) + regression tests - small, independent.
1. Finalize SKILL.md + template + references content in this discussion.
2. Create worktree / feature branch (forge flow or create_workspace).
3. Add skill source under packages/core/src/skills/create-skill/.
4. Add SkillValidateTool + SkillPersistTool classes + tests; register in index.ts.
5. Add skill-nudge extension + tests (root-only, once/session, ctx.hasUI).
6. Add forge-init-context injection + tests (agents-memo INIT.md pattern).
7. Run repo validation loop (fix, lint, typecheck, test) - capture verbatim output.
8. PR-style review; merge to main.
9. Deploy skill to ~/.forge/skills/create-skill/ (re-run forge:init or copy).
10. Fresh-session smoke test: /skill:create-skill lists; trigger fires; tools
    respond; nudge + init context appear once; deliverAs regression passes.
11. Iterate gotchas into references/ after real usage.

## 7. Open questions - status

- Q1 (resolved): Reach = feature-forge only. No pi-config mirroring - single source
  of truth; create-skill reaches every session on machines with feature-forge
  installed.
- Q2 (resolved): Nudge delivery = REAL queued user message (pi.sendUserMessage
  from agent_settled, idle so immediate). Agent must reflect in-context to
  create skills; passive notices can't. Cost controlled by: once/session latch,
  root-session only, ctx.hasUI guard, one-line reply constraint.
- Q3 (open, default cli-colocated): Domain logic home - inside cli tool classes
  (minimal, v1) vs new core class (SkillAuthoringService?) if tools/routines grow.
- Q4 (resolved): Default global target for skills created by the meta-skill =
  `~/.forge/skills` (forge family). `~/.pi/agent/skills` (pi-config) remains a
  documented alternative in the rubric for machine-synced non-forge skills.
- Q5 (open, default plain snake_case): Tool naming - skill_validate /
  skill_persist (matches spawn_agent / send_task convention).
- Q6 (resolved): Full v1 - ship SkillValidateTool + SkillPersistTool alongside the
  skill bundle and nudge (extension exists, so tools replace scripts per the
  one-home-per-capability rule).
- Q7 (open): Where this plan file ends (delete / fold into skill references /
  keep in docs).

## 8. Out of scope (future)

- Skill eval harness (skill-creator-style A/B), usage telemetry via events.
- Automating promotion/demotion with usage data.
- Forge flow variant of create-skill (routine/flow rather than skill).
- Package-marketplace distribution of generated skills.

## 9. Appendix - forge init-context draft (approved)

The always-on context block the forge extension injects once per session in the
root session (agents-memo INIT.md pattern). Stored as a typed constant in
packages/cli/src/extensions/forge-init-context.ts (one home; no fs/packaging
concerns). Content approved verbatim:

```
[feature-forge: session init]
# feature-forge - session init

This session runs the feature-forge extension: forge flows (/forge:*), sub-agent
routines, worktree management, and the forge toolset (skills: /skill:forge-build,
/skill:forge-verify, ...; tools: create_workspace, run_build_loop, spawn_agent, ...).

## When to engage forge
- The user invokes a /forge:* command or asks to run a flow - follow the active flow
  file and drive its routine tools.
- The user asks to plan, build, review, verify, or open a PR for an issue - offer the
  matching flow instead of improvising.
- Work needs an isolated git worktree - use the workspace routines.

## Skill self-improvement policy
feature-forge carries a meta-skill: create-skill, backed by the skill_validate and
skill_persist tools. When a procedure recurs - the 2nd time you do something
non-trivial, or you re-research a topic already solved - opportunistically create or
extend a skill instead of repeating ad-hoc work.
- Default scope: project skill at <repo>/.pi/skills/, committed with the current work,
  no confirmation needed.
- Global skills (~/.forge/skills default, ~/.pi/agent/skills when machine-synced via
  pi-config is wanted): propose, but write only after the user confirms.
- Search first: all skill names + descriptions are listed at session start. Extend an
  existing skill on overlap; one home per capability - never duplicate.
- Validate before declaring done: follow the structure mandate and run skill_validate.

## When NOT to engage forge
One-off work with no repetition, or no flow requested - do not invent forge ceremony,
spawn sub-agents, or create worktrees unasked. Skills encode the HOW of recurring
work; they do not replace answering the question.
```
