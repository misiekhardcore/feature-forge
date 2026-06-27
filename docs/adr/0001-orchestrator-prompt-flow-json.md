# ADR 0001: Orchestrator prompt lives in flow JSON; single template resolver is FlowContext.resolve

**Date:** 2026-06-26
**Status:** Superseded 2026-06-26 by the routine-based flow architecture (see `PLAN.md` and `UPDATED_FLOW_ARCHITECTURE.md`). The orchestrator prompt no longer lives as an embedded `orchestrator.task` JSON string; a flow package references an `orchestrator.prompt` markdown file plus an `activeTools` set, and orchestration across phases is driven by the main pi session calling routine tools. The principle 'one orchestrator prompt, one template resolver' still holds and is carried forward.

## Context

The orchestrator prompt existed in two places — `src/agents/prompts/orchestrator.md` (a standalone markdown file loaded via `loadPromptTemplate()`) and `implement.json orchestrator.task` (a JSON-escaped string inside the flow definition). This duplication created drift risk: updates to one source did not propagate to the other.

Additionally, the `orchestrator.spec` field in `OrchestratorSchema` declared a "main-session profile" (`"implement-orchestrator"`) that had no corresponding `AgentSpecification` implementation and had no consumer reading it anywhere in the codebase. It was dead metadata.

Finally, the orchestrator prompt contained placeholder tokens (`{{CONTEXT}}`, `{{WORKSPACE}}`) with no provider — no code injected those values, and the design intends workspace info to flow to the LLM via the tool result, not the initial prompt.

## Decision

1. **Single source of truth.** The orchestrator prompt is the `orchestrator.task` field in the flow JSON (e.g., `implement.json`). There is no separate prompt file. The future `FlowCommand` loads this field and resolves `{{task}}` via `FlowContext.resolve()`.

2. **Lowercase placeholder convention.** All placeholders in flow templates use lowercase (`{{task}}`, `{{plan}}`, `{{feedback}}`, `{{workspace}}`), matching `FlowContext.resolve()`.

3. **Dead tokens removed.** `{{CONTEXT}}` and `{{WORKSPACE}}` removed from the orchestrator prompt. Workspace information flows to the LLM via the `run_implement_loop` tool result, not the initial prompt. Context is user-provided at command invocation.

4. **`orchestrator.spec` removed.** `OrchestratorSchema` is now `{ task: Type.String({ minLength: 1 }) }`. The `Orchestrator` type loses `spec`. If a main-session profile feature is added later, it would reintroduce `orchestrator.spec` via a discriminated extension (per AGENTS.md "Public API evolution" — extend, don't modify).

## Consequences

- `src/agents/prompts/orchestrator.md` deleted.
- `implement.json` orchestrator block simplified.
- `OrchestratorSchema` and `Orchestrator` type reduced.
- `flow-schema.json` regenerated (Orchestrator `$defs` now requires only `task`).
- All test fixtures updated — `makeValidFlow()` no longer sets `orchestrator.spec`.
- New round-trip test in `OrchestratorPrompt.test.ts` verifies full resolution.
- `docs/flow-engine.md` §2.3, §2.5 updated; `PLAN.md` §5 Gap 1/4 updated.
- _Note (2026-06-27): `docs/flow-engine.md` has been removed and `PLAN.md` was reorganized; the design is consolidated in `PLAN.md` (current) and `UPDATED_FLOW_ARCHITECTURE.md`._
