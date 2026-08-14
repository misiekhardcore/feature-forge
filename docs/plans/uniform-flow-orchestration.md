# Uniform Flow Orchestration — Eliminate the Headless Flow Path

Status: planned (post PR #215)

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

## Goal

Uniform behavior: every flow is driven by an in-session orchestrator persona
via routine tools (ADR-0007). The headless path is removed entirely, and the
requirement is enforced by the flow schema so no future flow can regress.

## Changes

1. **Add `review/orchestrator.md` and `verify/orchestrator.md` personas**
   - ids `review-orchestrator` / `verify-orchestrator`, `role: orchestrator`,
     `model: smart`
   - tools: the flow's routine tool (`inspect` / `check`), `set_flow_param`,
     `set_session_name`, `read`, `grep`, minimal `bash:*` allowlist
   - persona job: take the user's task, map it to routine params (`changes`,
     optional `workspace`), call the routine, report verdict + findings

2. **Declare `orchestrator` blocks in `review/flow.json` and `verify/flow.json`**
   - same shape as implement:
     `{ systemPrompt, prompt: "{{prompt}}", promptParams: { TASK: "{{prompt}}" } }`

3. **Make `orchestrator` required in `flow-schema.json`**
   - add to the `required` array; make `orchestrator` non-optional in
     `FlowInstruction.ts`
   - flows without a persona fail loudly at load time (schema validation)

4. **Delete the headless path**
   - remove `HeadlessFlowCommand.ts` and its export in `commands/index.ts`
   - drop the `orchestrator.md` fork in `FlowRegistrar.ts` (always register
     `OrchestratorCommand`)
   - remove the "use a headless command instead" guard in
     `OrchestratorCommand.ts`

5. **Tests**
   - add `review` and `verify` blocks to `flow-roundtrip.test.ts` (the five
     standard assertions; currently only implement and resolve-pr-feedback
     are covered)
   - update `FlowRegistrar.test.ts`: headless fixture becomes a
     schema-rejected fixture (flow without orchestrator is skipped with a warn)
   - adjust `FlowLoader` tests for the required orchestrator field

6. **Amend ADR-0007**
   - flow execution model: all flows are driven by in-session orchestrator
     personas via routine tools; headless execution removed; review/verify
     personas added to match implement; schema enforces it

## Invariants

- The `inspect` / `check` routine tools stay registered regardless of the
  command path — implement's build loop references them via routine refs, and
  tool-level users are unaffected.
- Existing projects pick up the new `orchestrator.md` files by re-running
  `forge:init` (scaffolding is non-destructive and copies only missing files).
- The review/verify personas are LLM intermediaries over a deterministic call
  (parse → routine → report). This is the cost of uniformity — implement pays
  it too — and the persona gains the ability to summarize findings, decide
  retries, and stay extensible the same way for every flow.

## Acceptance

- `get_commands` in a scaffolded project shows `forge:review` and
  `forge:verify` as orchestrator commands
- running `/forge:review` mounts a visible orchestrator persona agent that
  calls the `inspect` routine tool, matching `/forge:implement` behavior
- flow without `orchestrator` in flow.json fails validation at load
- full validation loop passes (fix, lint, typecheck, test)
