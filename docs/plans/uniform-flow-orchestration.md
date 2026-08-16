# Uniform Flow Orchestration — Eliminate the Headless Flow Path

Status: planned (post PR #215) — revised 2026-08 with codebase research

## Problem

`FlowRegistrar.registerFlow` forks on the existence of `orchestrator.md` in a
flow directory:

| Flow                               | Path                  | Result                                                                                                                                             |
| ---------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `implement`, `resolve-pr-feedback` | `OrchestratorCommand` | mounts an in-session orchestrator persona (ADR-0007 design) — visible agent driving routines via tools                                             |
| `review`, `verify`                 | `HeadlessFlowCommand` | deterministic handler parses `key=value` args and runs the routine inline — blocks the conversation with "Running review...", no agent, no persona |

Review and verify predate the orchestrator-command work and were left headless
because they are single-routine flows. This is special handling: users observe
different behavior for `/forge:review` and `/forge:verify` than for
`/forge:implement` (no visible agent activity, blocking TUI, failure messages
that hide the real cause).

Research confirmed the root cause of the blocking asymmetry: pi's runtime
**awaits slash-command handlers inline**
(`packages/coding-agent/src/core/agent-session.ts:1268-1290`,
`_tryExecuteExtensionCommand` → `await command.handler(...)`). While the
handler promise is pending the agent loop is fully blocked — no turn
interleaves, no interrupt is honored, no TUI activity is rendered.
`HeadlessFlowCommand.handler` runs the *entire* routine inside the handler
(`HeadlessFlowCommand.ts:65`), so headless flows block the conversation;
`OrchestratorCommand.handler` returns immediately after
`pi.sendUserMessage(task)` (`SessionAgent.ts:75-85`), so orchestrator flows do
not — progress is driven asynchronously by events from `RoutineTool`.

The same research surfaced two further clusters of issues that this plan now
covers: presentation hygiene in the TUI surface (workstream B) and a set of
in-session agent presentation defects that ADR-0007 under-specified
(workstream C).

## Goal

1. **Uniform flow behavior**: every flow is driven by an in-session
   orchestrator persona via routine tools (ADR-0007). The headless path is
   removed entirely and the requirement is enforced by the flow schema so no
   future flow can regress. (Workstream A)
2. **Follow-up hygiene**: remove the duplication and special cases the
   headless path and the TUI pipeline accumulated. (Workstream B)
3. **The agents list is a subprocess-agent surface**: in-session personas
   are excluded from the agent viewer and IPC agent list by an explicit
   family discriminator — the persona *is* the conversation (already visible
   in the chat, history in the session), so listing it as a stale metadata
   stub adds noise without information. ADR-0007's presentation contract is
   completed, not just amended. (Workstream C)

---

## Workstream A — Headless path elimination

### A1. Add `review/orchestrator.md` and `verify/orchestrator.md` personas

- ids `review-orchestrator` / `verify-orchestrator`, `role: orchestrator`,
  `model: smart`
- tools: the flow's routine tool (`inspect` / `check`), `set_flow_param`,
  `set_session_name`, `read`, `grep`, minimal `bash:*` allowlist
- persona job: take the user's task, map it to routine params (`changes`,
  optional `workspace`), call the routine, report verdict + findings.
- **The persona markdown must document the routine-tool param mapping**
  (`inspect(changes=..., workspace=...)`). `RoutineTool` builds a strict
  TypeBox schema from `routine.params`; the LLM will invent params and get
  rejected otherwise. Mirror the style of `implement/orchestrator.md` (tool
  list in frontmatter + workflow body naming each routine tool and its
  params).

### A2. Declare `orchestrator` blocks in `review/flow.json` and `verify/flow.json`

- Use the minimal correct shape (matches `resolve-pr-feedback/flow.json`):
  `{ systemPrompt: "<id>", prompt: "{{prompt}}" }`.
- **Do not copy implement's `promptParams: { TASK: "{{prompt}}" }`** — it is
  vestigial: `OrchestratorCommand.resolveTask` does a single-pass
  `replaceAll`, so `{{TASK}}` would substitute the literal string
  `"{{prompt}}"`. (See B3 — remove it from implement's flow.json too.)

### A3. Make `orchestrator` required in the flow schema (codegen chain)

- Flip `FlowInstruction.ts:229` from `Type.Optional(OrchestratorConfigSchema)`
  to the bare schema. `flow-schema.json` is **generated**, not hand-edited:
  `npm run flow:generate-schema` regenerates it and `npm run
  flow:validate-json` validates every `flow.json` against it. The enforcement
  chain is: `FlowInstruction.ts` → generate → validate → build → re-init
  (see B8).
- Flows without a persona fail loudly at load time (`FlowRegistrar.ts:145-151`
  already warns and skips on load failure).

### A4. Delete the headless path

- Remove `HeadlessFlowCommand.ts` and its export in `commands/index.ts:7`.
  The file is ~150 lines of dead parser/schema code (`parseArgs`,
  `buildValidationSchema`) with no reuse value — the persona path receives raw
  prose, not `key=value` tokens.
- Drop the `orchestrator.md` fork in `FlowRegistrar.ts:169-212`: always
  `specManager.loadFromDirectory(flowDir)` + register `OrchestratorCommand`.
  The shared work (load + validate + flowMap + routine tools +
  `set_flow_param`) is already fork-independent (`FlowRegistrar.ts:120-168`).
- Remove the "use a headless command instead" guard in
  `OrchestratorCommand.ts:59-64` (unreachable once the schema requires
  `orchestrator`).
- Decide the near-dead `if (!this.specManager)` guard
  (`OrchestratorCommand.ts:66-70`): the constructor requires `specManager`,
  so drop it.

### A5. Tests

- Add `review` and `verify` blocks to `flow-roundtrip.test.ts` (the five
  standard assertions; currently only implement and resolve-pr-feedback are
  covered). The `!` non-null assertions on `flow.orchestrator`
  (`flow-roundtrip.test.ts:122-153`) only hold once the field is required.
- Update `FlowRegistrar.test.ts`: the headless fixture
  (`FlowRegistrar.test.ts:180-201`, keys off `fs.access` ENOENT) becomes a
  schema-rejected fixture (flow without orchestrator skipped with a warn).
  The `accessMock` plumbing and `vi.mock("node:fs/promises")` block become
  vestigial and should be trimmed.
- Flip optional-orchestrator fixtures to rejection tests:
  `FlowLoader.test.ts:56` and `FlowInstruction.test.ts:696` ("accepts missing
  orchestrator (optional for headless/library flows)").
- `OrchestratorCommand.test.ts`: remove any assertion on the deleted guard.

### A6. Amend ADR-0007 (flow execution model)

- All flows are driven by in-session orchestrator personas via routine tools;
  headless execution removed; review/verify personas added to match implement;
  schema enforces it. (The presentation-side ADR fixes live in C5.)

---

## Workstream B — Follow-up hygiene

### B1. Apply routine param defaults in `RoutineTool.execute`

Today `HeadlessFlowCommand.parseArgs` applies `routine.params[].default`
(`HeadlessFlowCommand.ts:129-136`) — e.g. `review`/`verify` declare
`workspace` with `default: "."`. The orchestrator path never applies routine
defaults: `RoutineTool` forwards only call params (`RoutineTool.ts:113-117`)
and `FlowContext.resolvePlaceholder` yields `""` for missing params. After A4,
an omitted `workspace` would spawn the agent step with `cwd: ""` — a silent
regression.

Fix: apply `param.default` for missing params in `RoutineTool.execute`
(one line, benefits every flow, makes the declared `default` fields honest).
Routine-level defaults must not be confused with flow-level `params` defaults
(already seeded into `FlowStateStore` at `FlowRegistrar.ts:129-136`).

### B2. Generalize the session-name fallback

`SessionAgent.mount` hardcodes `pi.setSessionName("implement")`
(`SessionAgent.ts:75`) on every mount. With `review-orchestrator` /
`verify-orchestrator` personas the fallback mislabels those sessions until the
persona calls `set_session_name`. Fix: derive from the spec/flow id
(e.g. `this.specification.id`) or drop the fallback entirely — the persona is
granted `set_session_name` and sets the real name anyway
(`implement/orchestrator.md` Phase 1 step 2).

### B3. Drop vestigial `promptParams`

Remove `promptParams: { TASK: "{{prompt}}" }` from `implement/flow.json`
(and don't reintroduce it elsewhere). `resolveTask` never references the key;
the field is dead configuration.

### B4. Extract a `showAgentViewer` composer

`RoutineTool.execute` (`RoutineTool.ts:200-239, 327-331`) and
`AgentListCommand.handler` (`AgentListCommand.ts:25-78`) contain near-identical
~45-line overlay blocks: `SharedStreamDir.get` → wrap event bus →
`wireOverlayEvents` → `ctx.ui.custom({ overlay: true, overlayOptions })` →
`new AgentViewerOverlay` → `connect(viewer, streamDir)` → dispose/dismiss
cleanup. Extract a single composer owning the whole lifecycle
(`showAgentViewer({ ctx, eventBus, agentQuery, config, toolRegistry, cwd })`
returning a dispose handle) and have both call sites use it. Also remove the
redundant `new TypedEventBus(this.executor.eventBus)` wrap in `RoutineTool`
(`RoutineTool.ts:206`) — the bus is already typed at boot.

### B5. Unify the status model

Four-to-five hand-written status vocabularies with bridges today:

| Vocabulary | Values | Where |
|---|---|---|
| `AgentStatus` (enum) | Spawned / Running / Completed / Failed / Cancelled | `shared/src/agents/AgentStatus.ts` |
| viewer entry union | "started" / "done" / "error" | `tui/src/types/*AgentEntry.ts` |
| `AgentProgressStatus` | "started" / "done" / "error" | `tui/src/progress/ProgressEvent.ts:8` |
| display contributions | "started" / "done" / "streaming" (orphan — exists nowhere in the union) | `AgentStepExecutor.ts:223-226` |
| overlay `mapStatus` | lossy 5→3: Spawned+Running→"started", Failed+Cancelled→"error" | `AgentViewerOverlay.ts:380-399` |

Unify to one **lossless** mapping owned by a single helper (in
`AgentDisplayHelpers` or shared):

- Spawned → `started`, Running → `running`, Completed → `done`, Failed →
  `error`, Cancelled → `cancelled`.

Concretely:
- Expand the viewer entry union to `started | running | done | error |
  cancelled`; make `mapStatus` delegate to the unified mapping and return the
  union type (kills the three `as AgentViewerEntry` casts at
  `AgentViewerOverlay.ts:431,465,565`).
- Drop `streaming` as a status — stream events do not change status; while
  streaming the agent is `running`/`started` (also unblocks
  `RoutineTool`'s stream-only contribution skip).
- Remove the dead `"running"` branches in `getStatusLabel`/`getStatusIcon`
  (`AgentDisplayHelpers.ts:125-127,151-152`) and `mapStatus`'s `"unknown"`
  default.
- Type `DisplayContribution.agentStatus` and
  `AccumulatedState.agentMap.status` as the union instead of `string`.
- Optional: replace the ad-hoc `AgentViewerEntry` object literals with a
  typed builder.

This is the enabling cleanup for C3 (in-session terminal states) — it is a
precondition, so do it in the same PR as workstream C or immediately before.

### B6. Unify result-suffix derivation

`ProgressRenderer.buildResultSuffix` (`ProgressRenderer.ts:133-186`),
the registry-derived `AccumulatedState.resultSnippet`
(`SessionStepExecutor.ts:53-60`), and the inline `details` object in
`RoutineTool`'s `onUpdate` (`RoutineTool.ts:284-301`) are three ways to
summarize a routine result, with the renderer preferring the registry snippet
over its own static suffix. Make the registry snippet the single path and
have `buildResultSuffix` delegate to it (or remove one of the two).

### B7. Validate orchestrator spec resolvability at load

Today a flow whose `orchestrator.systemPrompt` names a spec with no matching
`orchestrator.md` id passes load and fails late, at command invocation
(`OrchestratorCommand.ts:104-108`, `SpecManager.resolve` throws). With
`orchestrator` required (A3), validate in `FlowLoader`/`FlowRegistrar` that
the named spec resolves against the known-specs set (the same check A5's
roundtrip test asserts at test time) so the failure is loud at load.

### B8. Codegen chain and build steps (document in the PR checklist)

- `dist/` is git-ignored and regenerated by tsup's `onSuccess` copy
  (`tsup.config.ts:25-28`); `forge-setup.js` scaffolds from `dist` when
  installed, falling back to `src` in-tree (`resolveAssetsDir`,
  `forge-setup.js:96-109`).
- So the invariant "re-run `forge:init`" requires: edit `FlowInstruction.ts`
  → `npm run flow:generate-schema` → `npm run flow:validate-json` →
  `npm run build` (so the new `review/orchestrator.md` /
  `verify/orchestrator.md` land in `dist/flows`) → re-run `forge:init` in
  consumer projects. `forge:init` already tells the user to restart pi.

### B9. Error-path UX decision

Today a spec-resolution failure in the headless path surfaces as a notify
(`HeadlessFlowCommand.ts:74`). After the switch, handler throws bubble through
`_tryExecuteExtensionCommand`'s catch and are emitted as extension error
events (`agent-session.ts:1284-1290`), not notifies. Decide the target: for
invocation-time failures (unknown spec, missing tools) prefer an explicit
`ctx.ui.notify` in the handler before mounting; reserve thrown errors for
genuinely unexpected failures.

### B10. Opportunistic cleanups while touching these files

- `AgentStepExecutor` JSON-retry loop duplicates the `onEvent` stream-emission
  closure twice (`AgentStepExecutor.ts:102-105, 147-150`) — extract.
- Command description strings: `OrchestratorCommand.ts:53` ("Run the X
  orchestrator workflow") becomes the only description for every flow —
  drop the qualifier or keep it uniformly.

---

## Workstream C — In-session agent presentation (ADR-0007 fixes)

Context: ADR-0007 unified identity + lifecycle but left the in-session
presentation contract undefined. Today the orchestrator persona appears in the
agent list (`/agent:list`, overlay) only via the one-shot `getAllAgents()`
snapshot at connect — pinned at "started" forever, with **no lifecycle
transitions, no history, no stream**, and its only terminal state (`Cancelled`,
via `/flow:exit`) maps to `"error"` in the viewer.

**Decision (2026-08): the agents list is a subprocess-agent surface.
In-session personas are not listed.** The persona is the main conversation —
already visible in the chat, its history is the session itself, and it has no
RPC stream to show. Listing it as a metadata-only stub adds noise without
information. Fix the list surfaces to exclude in-session agents by an explicit
family discriminator, instead of making the persona fit the subprocess
presentation model.

### C1. Exclude in-session personas from the agent list

Add a family discriminator and filter every list surface:

- Add `kind: "subprocess" | "in-session"` (abstract) to the base `Agent`
  (`Agent.ts`); implement in `PiSubprocessAgent` (`"subprocess"`) and
  `SessionAgent` (`"in-session"`).
- Expose `kind` through the `AgentQuery` projection in `tui/src/api.ts` — the
  viewer cannot import CLI types, and the query is already the structural
  seam between the two packages.
- Filter in `AgentViewerOverlay.connect`'s `getAllAgents()` seeding loop
  (`AgentViewerOverlay.ts:552-566`). This covers both the routine-auto-open
  overlay and `/agent:list` (AgentListCommand uses the same wiring). Forge
  `agent-*` events are already subprocess-only, so no other overlay path needs
  filtering.
- Filter in `ParentSocketServer.handleListAgents` (`ParentSocketServer.ts:326-331`)
  so the IPC `list_agents` tool (used by subprocess children) sees only sibling
  subagents, not the parent's persona.
- **Guard the destroy paths** (same family as the list exclusion — the
  persona must not be managed as a subagent). Today `/agent:destroy-all`
  (`AgentDestroyAllCommand` → `supervisor.destroyAll`) destroys *everything*,
  including a mounted persona — silently killing the active flow — despite
  its "subagents" description; `/agent:destroy <id>`
  (`AgentDestroyCommand`) and the IPC `destroy_agent` handler
  (`ParentSocketServer.handleDestroyAgent`) have no guard either, unlike
  `send_task`/`get_result` which already check `isSubprocessAgent`
  (`ParentSocketServer.ts:197, 320`). Fix: filter `/agent:destroy-all` to
  `kind === "subprocess"` (count only those), refuse in-session agents in
  `/agent:destroy` with a "use /flow:exit" notify, and add the same
  `isSubprocessAgent` guard to IPC `destroy_agent`.

Consequence: no `SessionAgent` lifecycle events are needed (the earlier
"emit `agent-started`/`agent-done` from mount" idea is dropped), no
`channels.ts` optional-`executionId` change, no viewer placeholder for
in-session agents.

### C2. Documented current behavior (rationale)

Verified behavior being fixed: the persona's history lives *only* in the main
pi session JSONL (`getSessionsDir()` → `~/.pi/agent/sessions/*.jsonl`, written
by pi itself) — forge writes nothing for it. The agent viewer shows a
metadata-only stub: at connect it seeds
id/role/model/thinkingLevel/createdAt from `agentQuery.getAllAgents()` and
nothing ever updates it (no forge events, no stream files). By contrast,
subprocess agents get forge-owned per-agent files under
`<logDir>/agent-streams-*/` — `{agentId}.stream` (formatted lines),
`{agentId}.events.jsonl` (raw events, rotated at 50k lines),
`{agentId}.messages.jsonl` (finalized user/assistant/toolResult messages from
`message_end` events) — persisted by `AgentViewerState` while the overlay is
open, replayable later via `prepopulateStreamFiles`.

Decision: personas are not listed (C1), so the stub disappears entirely and no
mirroring into agent stream files is needed. The persona's history stays in
the pi session JSONL. Revisit only if a consumer later wants the persona in
the list with a proper presentation model of its own.

### C3. Terminal-state presentation (subprocess agents)

The in-session terminal question disappears from the viewer (personas are not
listed). B5's lossless vocabulary still applies to subprocess agents:
`Cancelled → "cancelled"` (e.g. a subagent destroyed via `/agent:destroy` or
destroy-all), distinct from `error`. No `done`-for-in-session addition needed.

### C4. Lifecycle ownership — decided: no auto-exit

`OrchestratorCommand` caches `this.spec`/`this.agent` and never destroys the
mounted `SessionAgent` — it stays `Running` in the supervisor forever and the
`before_agent_start` hook stays armed (suppressed only by the `unmounted` flag
after destroy). Re-running `/implement` re-enters `mount` deliberately.

**Decision (2026-08): keep manual `/flow:exit` — do not exit the flow
automatically.** The persona stays mounted until the user exits. Because
personas are not listed (C1), their perpetual `Running` state is not presented
anywhere — no stale stub, no terminal-state consequence. A completion signal /
auto-unmount is rejected.

### C5. Amend ADR-0007 (presentation contract)

Extend the ADR: the agents list / viewer is a **subprocess-agent surface**;
in-session personas are excluded by the `kind` discriminator; their history is
the pi session, not forge agent-stream files; the earlier `Mounted`-state
question is moot — personas are not displayed, so no new in-session status is
needed.

---

## Workstream D — Residual special cases (research pass 2)

A second research pass over the codebase found more special cases that the
first pass did not capture. All are in the same registration/presentation
plumbing, so they fold into PR 1 or PR 2 rather than a new workstream.

### D1. `set_flow_param` per-flow registration collides (correctness bug)

Every flow registers a routine tool literally named `set_flow_param` into the
one shared `ToolRegistry` (`FlowRegistrar.ts:157-163` via
`createSetFlowParamTool` → `RoutineTool`, whose name is `routineDef.id` =
`"set_flow_param"`, `RoutineTool.ts:115`). `ToolRegistry.registerInstance`
**throws on duplicate names** (`ToolRegistry.ts:38-40`), so only the
first-registered flow's tool survives — bound to *that* flow's `RoutineExecutor`
and `FlowStateStore` — and the other flows' registrations fail silently
(caught + warn at `FlowRegistrar.ts:160-163`). Any other flow's persona that
calls `set_flow_param` then writes into the wrong flow's store.

Today this is masked (review/verify have no personas); the plan gives every
flow an orchestrator persona with `set_flow_param` in its tool list, turning
the latent defect into live cross-flow state bleed.

Options (pick one in PR 1):
- **(a) Declare `set_flow_param` in each `flow.json`** (a routine like any
  other) and delete `createSetFlowParamTool.ts` — flows become fully
  self-describing, the builtin special-case registration path disappears, and
  each flow naturally owns its routine under its own name. Cost: a small
  boilerplate block per flow.json.
- (b) Register one shared `set_flow_param` tool that routes to the active
  flow's store — needs a "current flow" concept that does not exist today.
- (c) Flow-scoped tool name (`<flow>_set_flow_param`) — forces flow-specific
  tool lists in every orchestrator.md.

Recommend (a): it removes a code path (`createSetFlowParamTool`), a
registration try/catch, and a cross-flow invariant, at the cost of a few
lines per flow.json.

**Decision (2026-08, supersedes PR #218)**: PR #218 shipped option (a) with
flow-scoped routine ids (`` `<flow>_set_flow_param` ``). PR feedback reworked
D1 to option (b): a single shared `set_flow_param` tool registered globally
(like `set_session_name`) that routes to the active flow's store via a new
`ActiveFlowRegistry` (see ADR 0015). Rationale: flow-scoped names leak an
implementation detail into every persona's tool list and diverge from the
original intent — session params belong to the flow session, and sub-flows
inlined via routine refs already share the parent's store (ADR 0011); a
shared tool matches that model. The flow-scoped routine declarations were
removed from the four flow.json files and persona docs reverted to the
shared name.

### D2. Dead legacy progress-reporting abstraction

`packages/tui/src/progress/` contains **two progress systems**. The live one
is `ProgressWidget` (`render(lines, status)` / `clear`, implemented by
`TuiRoutineWidget`). The legacy one — `ProgressReporter` abstract
(`update(event)` / `getState()` returning `ProgressSnapshot`),
`EMPTY_PROGRESS_SNAPSHOT`, `ProgressEvent` / `AgentProgressStatus`
("started"/"done"/"error") — has **zero consumers** beyond barrel re-exports
(`tui/src/index.ts:26-31`). `NoOpProgressReporter` bridges both worlds: it
`extends ProgressReporter` (dead base, only its no-op `update` override) and
`implements ProgressWidget` (live).

Cleanup: delete `ProgressReporter.ts` + `ProgressEvent.ts`, make
`NoOpProgressReporter` implement `ProgressWidget` directly (drop the `extends`
and the `update` override), remove the barrel exports. Kills the "two progress
systems" confusion and the stale "error" display vocabulary (overlaps B5).

### D3. `"skipped":true` raw-string matching

`RoutineExecutor.collectSkippedIds` detects skipped loops by
`result.raw.includes('"skipped":true')` (`RoutineExecutor.ts:242`). The marker
only exists inside the loop's `raw` JSON (`LoopStepExecutor.ts:69`,
`JSON.stringify({ iterations: 0, maxIterations, skipped: true })`), while the
loop already produces a structured `parsed` result. The string search
misclassifies any step output that merely *mentions* `"skipped":true`.

Fix: carry `skipped` on the structured result (extend `InstructionResult`
with an optional `skipped` flag, or put it in `parsed`) and have
`collectSkippedIds` read it structurally.

### D4. Dual emitters of agent lifecycle channels

`feature-forge:agent-started|stream|done` payloads are hand-built in two
places: `AgentStepExecutor` (routine `agent` steps, `AgentStepExecutor.ts:92-185`)
and `ParentSocketServer` (direct `send_task` tool path,
`ParentSocketServer.ts:202-353`). Both must stay in sync with `channels.ts`.

Extract shared emit helpers (`emitAgentStarted/Done/Stream(eventBus, ...)`)
used by both emitters so the payload contract lives in one place. (The two
*paths* remain — routine steps vs direct tool calls — only the emission is
unified.)

### D5. `Command` variadic constructor

`Command` takes 7 optional positional dependencies (`Command.ts:16-26`);
concrete commands pass what they need and `undefined` for the rest, and
`ForgeInitCommand` is constructed as `new ForgeInitCommand(undefined as never,
pi)` (`index.ts:76`) — a type lie. Replace with an options bag (or a small
per-command needs interface) so no call site casts `undefined as never`.

### D6. Test-command overlay construction

`registerTestCommands.ts` has four more overlay construction sites
(`test-viewer`, `test-scroll`, `test-tool-args`, `test-stream-replay`
`ctx.ui.custom` blocks + `createViewer`) and a direct `TuiRoutineWidget`
use. The B4 `showAgentViewer` composer should serve these too (scenario
construction stays test-specific; the overlay/open/cleanup boilerplate is
shared).

---

## Invariants

- The `inspect` / `check` routine tools stay registered regardless of the
  command path — implement's build loop references them via routine refs
  (`call_review`, `call_verify` in `implement/flow.json`), and tool-level
  users are unaffected. Routine refs (`RoutineRefStepExecutor`) inline
  sub-flow steps into the parent context — this cross-flow path is unchanged.
- **Library-flow note**: after A3, a flow without `orchestrator` is skipped at
  load, and any flow referencing it fails at execution with "Unknown target
  flow" (`RoutineRefStepExecutor.ts:58-60`). Today a headless flow is fully
  usable as a ref-only target. Under this plan the built-ins all carry
  orchestrators, so built-in refs keep working; the plan accepts the behavior
  change for hypothetical third-party ref-only library flows and documents
  the migration (add a minimal `orchestrator` block).
- Routine-level param defaults apply uniformly in `RoutineTool` (B1) — the
  declared `default` fields become honest for every flow.
- Existing projects pick up the new `orchestrator.md` files by re-running
  `forge:init` (scaffolding is non-destructive and copies only missing
  files) — after `npm run build` so `dist/flows` is current (B8).
- In-session personas are excluded from the agent viewer, `/agent:list`,
  and the IPC `list_agents` surface by `kind` (C1); the viewer's subprocess
  assumptions (`AgentViewerState` stream files) remain subprocess-only by
  design (C2).

## Acceptance

- `get_commands` in a scaffolded project shows `forge:review` and
  `forge:verify` with the same description shape as `forge:implement` (note:
  `get_commands` exposes only name/description — there is no orchestrator
  marker; assert on description strings).
- `/forge:review` mounts a visible orchestrator persona that calls the
  `inspect` routine tool, matching `/forge:implement` behavior: the command
  returns immediately (TUI input stays live), the routine renders through the
  full pipeline (tool-row call/result, `forge-run` widget, `feature-forge`
  status, agent viewer overlay showing the `review` subprocess agent).
- In-session personas do **not** appear in `/agent:list` or the overlay;
  subprocess agents are unaffected (C1). No stale "started" stub for the
  orchestrator.
- `/agent:destroy-all` and `/agent:destroy` during an active flow leave the
  mounted persona untouched (destroy paths are `kind`-guarded); the persona
  is only exited via `/flow:exit` (C1).
- Subprocess agent terminal states render losslessly — `Cancelled` reads as
  "cancelled", never "error" (B5 + C3).
- Omitted optional routine params (e.g. `workspace`) fall back to the declared
  default in the orchestrator path (B1).
- Flow without `orchestrator` in flow.json fails validation at load (schema
  required, regenerated + validated — B8); referencing flows get a clear
  error.
- `packages/tui` renders no `streaming` status and exposes one status
  vocabulary (B5); overlay wiring lives in one composer (B4).
- Full validation loop passes (fix, lint, typecheck, test), plus
  `npm run flow:generate-schema` and `npm run flow:validate-json` with
  `git diff --exit-code` clean for generated artifacts.

## Sequencing & PR shape

> Copy-paste task briefs for each run: `docs/plans/uniform-flow-orchestration-run-briefs.md`.

- **Run 1 — PR (registration/flow layer): A.** Headless elimination + its tests.
  The hard dependency chain (personas → schema → deletion) is self-contained
  and verifiable against AC 1-3. **Do not inflate this run with hygiene
  items** — they get cleaner review on their own.
- **Run 2 — PR (hygiene): B1/B2/B3/B6/B7/B9/B10 + D1/D3/D5.** Same files,
  low risk, independent of A: `RoutineTool` defaults (B1), session-name
  fallback (B2), `promptParams` removal (B3), spec validation at load (B7),
  error-path notify (B9), opportunistics (B10), `set_flow_param` fix (D1 —
  resolves a latent correctness bug), structured skipped flag (D3),
  `Command` options bag (D5). B6 optional here or in Run 3.
- **Run 3 — PR (presentation): B4/B5/B6 + C + D2/D4/D6.** Requires B5 first:
  status vocabulary unification, dead progress abstraction removal (D2),
  agent-family `kind` discriminator + list/destroy filtering (C1),
  terminal-state presentation for subprocess agents (C3), shared agent-channel
  emit helpers (D4), test-command overlay reuse (D6), ADR amendments
  (A6 + C5). C2 is documentation-only; C4 is decided and needs no PR of its
  own.
