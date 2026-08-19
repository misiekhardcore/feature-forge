# ADR 0019: Flow engine in core with composition-root seams

**Date:** 2026-08-19
**Status:** Accepted

## Context

Issue #229 relocates the flow engine from the cli package into core so the
cli package becomes a thin composition root (issue AC2/AC3 layering). The
flow engine (`flows/*`, `routines/*`) depends on collaborators that stay in
cli until later batches of the same issue:

- `CommandRegistry`, `ToolRegistry` (stay in cli per the issue tree),
- `RoutineTool`, `OrchestratorCommand` (cli concretions),
- `StepExecutorRegistry`, `TypedEventBus`, `WorkspaceManager` (move to core
  in S4d / S4e).

Core must never import cli at runtime, so the relocation needs a seam that
lets core depend on structural surfaces while cli supplies the concretions.

## Decision

- `packages/cli/src/orchestrator/{flows,routines}/*` move to
  `packages/core/src/{flows,routines}/*`; per-directory barrels re-home the
  dissolved cli orchestrator barrel's exports; `cli/src/orchestrator/index.ts`
  is deleted.
- `FlowRegistrarContext` keeps core-owned collaborators concrete
  (`pi`, `supervisor`, `specManager`, `flowDirs`, `knownProviders`,
  `stepExecutorRegistry`, `eventBus`, `activeFlowRegistry`) and types the
  cli-owned collaborators structurally by the members actually consumed:
  `CommandRegistryLike` (`registerInstance`), `ToolRegistryLike`
  (`registerInstance`, `get`), `WorkspaceManagerLike` (`list`).
- `OrchestratorCommandDeps` is exported from core: core-owned collaborators
  use concrete types; cli-owned ones (`toolRegistry`, `workspaceManager`) are
  structural, typed by the members the cli `OrchestratorCommand` reads.
- Two factory types on the context — `CreateRoutineTool` and
  `CreateOrchestratorCommand` — are wired at the cli composition root
  (`cli/src/index.ts`): `(…) => new RoutineTool(…)` and
  `(deps) => new OrchestratorCommand(deps)`. The single documented `as never`
  cast there bridges core's structural deps and cli's concrete command deps.
- Transient core -> cli imports in moved production files are type-only
  (elided at emit, zero runtime edge) and each carries a comment naming the
  batch that self-heals it (S4d: `eventBus`, `StepExecutorRegistry`; S4e:
  workspace/ipc). Tests also import cli values at runtime until those batches.

## Consequences

- The flow engine's production code is cli-agnostic at runtime; cli supplies
  concretions at the composition root (DIP/ISP).
- The structural surfaces must track cli usage — the `as never` cast is a
  latent type hole if the two shapes drift; narrowing it (e.g. having
  `OrchestratorCommand` accept `ToolRegistryLike`) is planned when S4d moves
  the registries.
- Core's unit tests depend on cli's src tree at runtime until S4d/S4e/S6
  (test-only; does not ship).
- S11's restricted-imports lint enforces the direction (core never imports
  cli).
- ADR 0018 is reserved by the phase plan for S10's package-layering decisions
  (D1-D8); this ADR covers the S4c seam only.
