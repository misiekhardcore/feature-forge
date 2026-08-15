# Uniform Flow Orchestration — Implement Run Briefs

Companion to `docs/plans/uniform-flow-orchestration.md` (the source of truth —
read it first, this file only carves it into executable chunks).

Each brief is a copy-paste task for `/forge:implement`. One run = one PR. Run
them **in order**; after each PR merges, rebase the next run onto updated main
(AGENTS.md: `git fetch origin main && git rebase origin/main` before pushing)
and tick off the plan's Acceptance items before starting the next run.

- Run 1 — Headless path elimination (Workstream A)
- Run 2 — Hygiene in the touched files (B1-B3, B6, B7, B9, B10, D1, D3, D5)
- Run 3 — Presentation (B5, C1/C3/C5, B4, D2, D4, D6)

Deterministic gate for every run (AGENTS.md): run `npm run fix`, `npm run
lint`, `npm run typecheck`, `npm run test`, and for run 1 also
`npm run flow:generate-schema` + `npm run flow:validate-json`. Include the
verbatim output of each in the `summary` field of your final JSON block so the
verify agent can cross-check. Never report `passed: true` if any command fails.

---

## Run 1 — Headless path elimination (Workstream A)

Implement Workstream A of `docs/plans/uniform-flow-orchestration.md` (sections
A1-A5). The goal: `review` and `verify` flows behave exactly like `implement` —
driven by an in-session orchestrator persona via routine tools — and the
headless flow path is deleted, enforced by the flow schema.

Scope (all required):

1. **Personas** — add `packages/cli/src/flows/review/orchestrator.md` and
   `packages/cli/src/flows/verify/orchestrator.md`:
   - frontmatter ids `review-orchestrator` / `verify-orchestrator`,
     `role: orchestrator`, `model: smart`
   - tools: the flow's routine tool (`inspect` / `check`), `set_flow_param`,
     `set_session_name`, `read`, `grep`, minimal `bash:*` allowlist
   - persona job: take the user's task, map it to routine params (`changes`,
     optional `workspace`), call the routine, report verdict + findings
   - **the markdown body must document the routine-tool param mapping**
     (`inspect(changes=..., workspace=...)`) — `RoutineTool` builds a strict
     TypeBox schema from `routine.params`; the LLM will invent params and get
     rejected otherwise. Mirror the style of
     `packages/cli/src/flows/implement/orchestrator.md`.

2. **Orchestrator blocks** — add to `review/flow.json` and `verify/flow.json`
   the minimal shape `{ "systemPrompt": "<id>", "prompt": "{{prompt}}" }`
   (ids matching step 1). Do **not** add `promptParams` (vestigial — see B3,
   out of scope here).

3. **Schema required** — flip `orchestrator` from `Type.Optional(...)` to
   required in `packages/cli/src/orchestrator/FlowInstruction.ts` (line ~229),
   then run `npm run flow:generate-schema` (regenerates
   `packages/cli/src/flows/flow-schema.json`) and
   `npm run flow:validate-json`. `flow-schema.json` is generated — do not hand
   edit it.

4. **Delete the headless path**:
   - delete `packages/cli/src/commands/HeadlessFlowCommand.ts` and its export
     in `packages/cli/src/commands/index.ts`
   - drop the `orchestrator.md` `fs.access` fork in
     `packages/cli/src/orchestrator/FlowRegistrar.ts` (lines ~169-212):
     always `specManager.loadFromDirectory(flowDir)` then register
     `OrchestratorCommand`. The shared work before the fork (load + validate +
     flowMap + routine tools + `set_flow_param`) stays as is
   - remove the dead "use a headless command instead" guard in
     `packages/cli/src/commands/OrchestratorCommand.ts` (~lines 59-64) and the
     near-dead `if (!this.specManager)` guard (~lines 66-70)

5. **Tests**:
   - add `review` and `verify` describe blocks to
     `packages/cli/src/flows/flow-roundtrip.test.ts` with the same five
     standard assertions used by implement/resolve-pr-feedback (they require
     `orchestrator` to be non-null — now guaranteed)
   - rewrite the headless fixture in
     `packages/cli/src/orchestrator/FlowRegistrar.test.ts` (~lines 180-201):
     the flow without orchestrator is skipped with a warn; trim the
     now-vestigial `accessMock` / `vi.mock("node:fs/promises")` plumbing
   - flip the optional-orchestrator fixtures to rejection tests:
     `FlowLoader.test.ts` (~line 56) and
     `FlowInstruction.test.ts` (~line 696, "accepts missing orchestrator")
   - remove any assertions on the deleted guard in
     `OrchestratorCommand.test.ts`

Out of scope (later runs): Workstreams B, C, D. In particular do **not** touch
`RoutineTool` param defaults (B1), the session-name fallback (B2), or the
status model (B5).

Acceptance (from the plan):

- `get_commands` shows `forge:review` / `forge:verify` with the same
  description shape as `forge:implement` (assert on description strings — the
  API exposes only name/description).
- `/forge:review` mounts a visible orchestrator persona that calls the
  `inspect` routine tool: the command returns immediately (TUI input stays
  live), the routine renders through the full pipeline (tool-row call/result,
  `forge-run` widget, `feature-forge` status, agent viewer overlay showing the
  `review` subprocess agent).
- A flow without `orchestrator` in flow.json fails validation at load.
- Full validation loop passes, `flow:generate-schema` / `flow:validate-json`
  clean, `git diff --exit-code` clean for generated artifacts.

---

## Run 2 — Hygiene in the touched files (B + D1/D3/D5)

Implement the hygiene items of `docs/plans/uniform-flow-orchestration.md`:
Workstream B items B1, B2, B3, B6, B7, B9, B10 and Workstream D items D1, D3,
D5. All are independent of Run 1 (which must already be merged) and mostly
touch the same registration/command files.

Scope (all required unless marked optional):

1. **B1 — Routine param defaults in `RoutineTool`**: apply `param.default` for
   missing params in `RoutineTool.execute`
   (`packages/cli/src/orchestrator/RoutineTool.ts`, execute forwards only call
   params ~lines 113-117). Makes declared `default` fields (e.g. review/verify
   `workspace: "."`) honest in the orchestrator path. Flow-level `params`
   defaults (seeded in `FlowStateStore` at `FlowRegistrar.ts` ~lines 129-136)
   are separate — do not conflate.

2. **B2 — Session-name fallback**: `SessionAgent.mount` hardcodes
   `pi.setSessionName("implement")` (`SessionAgent.ts` ~line 75). Derive from
   the spec/flow id (e.g. `this.specification.id`) or drop the fallback
   (personas set the name via `set_session_name` anyway).

3. **B3 — Drop vestigial `promptParams`**: remove
   `promptParams: { TASK: "{{prompt}}" }` from
   `packages/cli/src/flows/implement/flow.json` (`OrchestratorCommand.resolveTask`
   never references the key).

4. **B7 — Spec resolvability at load**: validate that
   `flow.orchestrator.systemPrompt` resolves against the known-specs set in
   `FlowLoader` / `FlowRegistrar` instead of failing late in
   `OrchestratorCommand.handler` (`SpecManager.resolve` throws).

5. **B9 — Error-path UX**: for invocation-time failures (unknown spec, missing
   tools) prefer an explicit `ctx.ui.notify` in the handler before mounting;
   reserve thrown errors for genuinely unexpected failures.

6. **B10 — Opportunistics**: dedupe the JSON-retry `onEvent` stream-emission
   closure in `AgentStepExecutor.ts` (~lines 102-105 and 147-150). Unify the
   command description strings now that every flow uses `OrchestratorCommand`.

7. **D1 — `set_flow_param` collision fix (correctness)**: every flow
   registers a tool literally named `set_flow_param` into the shared
   `ToolRegistry`; `registerInstance` throws on duplicates, so only the
   first-registered flow's tool survives, bound to that flow's store — other
   flows' personas write into the wrong store. Recommended fix: declare
   `set_flow_param` as a normal routine in each flow.json and delete
   `packages/cli/src/orchestrator/builtins/createSetFlowParamTool.ts` and the
   registration try/catch in `FlowRegistrar.ts` (~lines 157-163). (Alternative
   options b/c are documented in the plan — prefer (a).)

   **Post-Run 2 rework (PR #218 follow-up)**: D1 shipped as option (a) with
   flow-scoped ids; reworked to option (b) — one shared `set_flow_param` tool
   routed through `ActiveFlowRegistry` (ADR 0015). See the D1 section of the
   plan for the decision record.

8. **D3 — Structured skipped flag**: `RoutineExecutor.collectSkippedIds`
   detects skipped loops via `result.raw.includes('"skipped":true')`
   (`RoutineExecutor.ts` ~line 242) while the marker only exists in the loop's
   `raw` JSON string (`LoopStepExecutor.ts` ~line 69). Carry `skipped` on the
   structured result (extend `InstructionResult` with an optional `skipped`
   flag or put it in `parsed`) and read it structurally.

9. **D5 — `Command` constructor**: replace the 7 optional positional deps
   (`packages/cli/src/commands/Command.ts`) with an options bag (or per-command
   needs interface) so no call site casts `undefined as never` (see
   `index.ts` ~line 76, `new ForgeInitCommand(undefined as never, pi)`).

10. **B6 — Suffix unification (optional in this run)**: make the
    registry-derived `AccumulatedState.resultSnippet` the single result-suffix
    path in `ProgressRenderer` (`buildResultSuffix` delegates), removing the
    parallel logic in `RoutineTool.onUpdate` (~lines 284-301). If this run is
    already large, defer to Run 3.

Out of scope: Workstream A (done), Workstream C, D2/D4/D6 (Run 3).

Acceptance:

- Omitted optional routine params (e.g. `workspace`) fall back to declared
  defaults in the orchestrator path.
- `/forge:review` / `/forge:verify` sessions are not mislabeled "implement".
- No `promptParams` / `TASK` anywhere in flow.json.
- `set_flow_param` works per-flow with no cross-flow state bleed; only one
  registration path exists.
- Skipped-loop detection is structural, not raw-string matching.
- No `undefined as never` casts remain in command construction.
- Full validation loop passes.

---

## Run 3 — Presentation (B5, C, B4, D2, D4, D6)

Implement the presentation workstreams of
`docs/plans/uniform-flow-orchestration.md`: B4, B5, C1/C3/C5, D2, D4, D6.
Requires B5 before C1 (the `kind` filtering depends on nothing, but the
terminal-state presentation in C3 uses B5's vocabulary). C2 and C4 are
decided/documentation-only — no code.

Scope (all required):

1. **B5 — Unify the status model** (do first). One lossless mapping owned by a
   single helper: `Spawned → started`, `Running → running`, `Completed →
   done`, `Failed → error`, `Cancelled → cancelled`.
   - expand the viewer entry union in
     `packages/tui/src/types/*AgentEntry.ts` to
     `started | running | done | error | cancelled`
   - `AgentViewerOverlay.mapStatus` (~lines 380-399) delegates to the unified
     mapping and returns the union type (removes the three `as
     AgentViewerEntry` casts at ~lines 431/465/565)
   - drop `"streaming"` as a status (`AgentStepExecutor.ts` ~lines 223-226);
     stream events keep the agent at `running`/`started`
   - remove the dead `"running"` branches in
     `AgentDisplayHelpers.getStatusLabel`/`getStatusIcon` and `mapStatus`'s
     `"unknown"` default
   - type `DisplayContribution.agentStatus` and
     `AccumulatedState.agentMap.status` as the union instead of `string`
   - optionally: typed builder for `AgentViewerEntry` literals

2. **C1 — Exclude in-session personas from the agent list**:
   - add `kind: "subprocess" | "in-session"` (abstract) to the base `Agent`
     (`packages/cli/src/agents/agents/Agent.ts`); implement in
     `PiSubprocessAgent` (`"subprocess"`) and `SessionAgent` (`"in-session"`)
   - expose `kind` through the `AgentQuery` projection in
     `packages/tui/src/api.ts`
   - filter in `AgentViewerOverlay.connect`'s `getAllAgents()` seeding
     (`AgentViewerOverlay.ts` ~lines 552-566) — covers both the routine overlay
     and `/agent:list`
   - filter in `ParentSocketServer.handleListAgents`
     (`ParentSocketServer.ts` ~lines 326-331)
   - **guard the destroy paths**: `/agent:destroy-all`
     (`AgentDestroyAllCommand`) destroys only `kind === "subprocess"`
     (count only those); `/agent:destroy` (`AgentDestroyCommand`) refuses
     in-session agents with a "use /flow:exit" notify; IPC `destroy_agent`
     (`ParentSocketServer.handleDestroyAgent`) gets the same
     `isSubprocessAgent` guard already used by `send_task`/`get_result`

3. **C3 — Terminal-state presentation**: no additional code beyond B5; verify
   a destroyed subagent renders `cancelled`, never `error`.

4. **C5 — Amend ADR-0007** (`docs/adr/0007-agent-hierarchy-subprocess-vs-in-session.md`):
   the agents list/viewer is a subprocess-agent surface; in-session personas
   are excluded by `kind`; their history is the pi session, not forge
   agent-stream files; no new in-session status is needed. (Also amend the
   flow-execution model per A6 if Run 1 did not already.)

5. **B4 — Extract a `showAgentViewer` composer**: unify the ~45-line overlay
   wiring duplicated in `RoutineTool.execute`
   (`RoutineTool.ts` ~lines 200-239, 327-331) and `AgentListCommand.handler`
   (`AgentListCommand.ts` ~lines 25-78), and reuse it in
   `registerTestCommands.ts` (four more sites). Also remove the redundant
   `new TypedEventBus(this.executor.eventBus)` wrap in `RoutineTool`
   (~line 206).

6. **D2 — Delete the dead progress abstraction**:
   `packages/tui/src/progress/ProgressReporter.ts` + `ProgressEvent.ts`
   (and their barrel exports in `tui/src/index.ts`); make
   `NoOpProgressReporter` implement `ProgressWidget` directly (drop the
   `extends ProgressReporter` and the `update` override).

7. **D4 — Shared agent-channel emit helpers**: extract
   `emitAgentStarted/Done/Stream` used by both `AgentStepExecutor`
   (`AgentStepExecutor.ts` ~lines 92-185) and `ParentSocketServer`
   (`ParentSocketServer.ts` ~lines 202-353) so the payload contract lives in
   one place.

8. **D6 — Test-command overlay reuse**: the four overlay construction sites in
   `registerTestCommands.ts` use the B4 composer; scenario construction stays
   test-specific.

Out of scope: Workstream A (done), B1-B3/B6-B10/D1/D3/D5 (done in Run 2), C2
(doc-only), C4 (decided — no code).

Acceptance:

- In-session personas do **not** appear in `/agent:list`, the overlay, or the
  IPC `list_agents` surface; subprocess agents unaffected.
- `/agent:destroy-all` and `/agent:destroy` during an active flow leave the
  mounted persona untouched.
- Subprocess agent terminal states render losslessly — `Cancelled` reads
  "cancelled", never "error".
- Exactly one status vocabulary across viewer, contributions, and
  `AgentDisplayHelpers`; no `"streaming"` status, no dead branches.
- `showAgentViewer` is the single overlay wiring owner (RoutineTool,
  AgentListCommand, registerTestCommands).
- `ProgressReporter`/`ProgressEvent` files gone; `NoOpProgressReporter`
  implements `ProgressWidget`.
- Full validation loop passes (including `packages/tui` tests).
