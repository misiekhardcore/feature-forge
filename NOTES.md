# NOTES — workstream-a-uniform-flow-orchestration

## Current task
- Subtask 4: delete the headless path (HeadlessFlowCommand, FlowRegistrar fork, OrchestratorCommand guards)

## Task list / AC checklist
- [ ] AC1 — `get_commands` shows `forge:review` / `forge:verify` with the same description shape as `forge:implement` (assert on description strings — the API exposes only name/description).
- [ ] AC2 — `/forge:review` mounts a visible orchestrator persona that calls the `inspect` routine tool: the command returns immediately (TUI input stays live), the routine renders through the full pipeline (tool-row call/result, `forge-run` widget, `feature-forge` status, agent viewer overlay showing the `review` subprocess agent).
- [ ] AC3 — A flow without `orchestrator` in flow.json fails validation at load.
- [ ] AC4 — Full validation loop passes, `flow:generate-schema` / `flow:validate-json` clean, `git diff --exit-code` clean for generated artifacts.

## Subtask plan
- [x] S1 — review flow: create `packages/cli/src/flows/review/orchestrator.md`, add orchestrator block to `packages/cli/src/flows/review/flow.json` (minimal shape `{ systemPrompt: "review-orchestrator", prompt: "{{prompt}}" }`, NO promptParams) — passed (3 rounds); gates: validate-json ✓, prettier ✓, tsc ✓, lint ✓, roundtrip 24 ✓, full suite 2077 ✓, e2e 70 ✓
- [x] S2 — verify flow: persona + orchestrator block + `{{changes}}` prompt + call_verify `changes: "{{task}}"` input — passed (retry 2, 1 round); commits 41feb938 + d8d384d0; review APPROVE, verify PASS, gates all green
- [x] S3 — Schema required: flip `orchestrator` from `Type.Optional` to required in `packages/cli/src/orchestrator/FlowInstruction.ts`; run `npm run flow:generate-schema` (regenerates `packages/cli/src/flows/flow-schema.json` — do not hand-edit) + `npm run flow:validate-json`; flip rejection tests in `FlowInstruction.test.ts` (~696) and `FlowLoader.test.ts` (~56) — passed (1 round); schema diff exactly one line (required gains orchestrator); 164+24+2081 tests green; builder also removed 6 now-unnecessary `orchestrator!` assertions in roundtrip test
- [ ] S4 — Delete headless path: delete `packages/cli/src/commands/HeadlessFlowCommand.ts` + its export in `commands/index.ts`; remove `fs.access` fork in `FlowRegistrar.ts` (always loadFromDirectory + register OrchestratorCommand); remove the two guards in `OrchestratorCommand.ts` (~59-70)
- [ ] S5 — Tests: add `review` + `verify` describe blocks to `packages/cli/src/flows/flow-roundtrip.test.ts` (standard five assertions); rewrite headless fixture in `FlowRegistrar.test.ts` (flow without orchestrator skipped with warn; trim accessMock / vi.mock("node:fs/promises") plumbing); check `OrchestratorCommand.test.ts` for assertions on deleted guards (none expected — confirm)

## Decisions made this session
- A6 (ADR-0007 amendment) excluded — user scope is A1-A5 only; B/C/D out of scope (later runs). (why: explicit user scope statement)
- S2 retry-2: review gate found the `{{changes}}` swap alone regresses the implement ref path — call_verify passes only `{workspace}` (#207 removed both halves together), and `FlowContext.resolvePlaceholder` returns the literal `{{key}}` for unknown params → literal `{{changes}}` garbage reaches the verify agent. Coupled fix (in-scope for A): call_verify input becomes `{ changes: "{{task}}", workspace: "{{workspace}}" }` — re-establishes the channel with the task string, preserving #207's builder.raw decoupling and matching implement orchestrator.md's contract that the verify agent sees only the task string. (why: without it the A-scope prompt change regresses the implement build loop)
- S2 verify-agent "critical" findings about S3-S5 are planned subtasks, not S2 defects — scope task strings tighter for later loops. (why: verifier over-scoped)
- Worktree is 1 commit behind origin/main (49f48867 vs 5cfd3940) — rebase before the final gate/open_pr. (why: validation loop step 1)
- E2E invocation quirk: use `npx vitest run --project cli-e2e` from repo root, not `npm -w ... run test:e2e`. (why: verify agent found config-root resolution issue)
- Persona frontmatter includes `skills: [notes-md]` mirroring implement/resolve-pr-feedback personas. (why: consistency; harmless)
- Subtask split: 5 subtasks, S1/S2 independent (both before S3's validate-json), S3 before S4/S5, S5 after S4. (why: atomicity, dependency chain personas → schema → deletion)

## Next action on resume
- Run S4 (delete headless path), then S5 (tests).
- Commit S1 review-flow files (uncommitted in worktree) — open_pr's add-and-commit will pick them up; confirm before Phase 3.
- Pre-existing main-worktree changes (plan docs) are NOT in this workspace — do not commit them.
