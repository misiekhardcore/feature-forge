# ADR 0019: Flow engine in core with composition-root seams

**Date:** 2026-08-19
**Status:** Partially superseded 2026-08-19 by the #229 rework. The structural
`*Like` surfaces, the `CreateOrchestratorCommand` factory, and the `as never`
cast are dissolved (commands and registries moved to core - R-S1/R-S2); the
test-utils interim is resolved (R-S3). The `createRoutineTool` seam remains in
force (`RoutineTool` stays cli-owned, D3). See [Superseded](#superseded).

## Superseded

The #229 rework dissolved most of this seam; the historical record below is
kept intact. What changed:

- **R-S1 - commands and registries moved to core.** `Command`,
  `OrchestratorCommand`, the `Worktree*` / `AgentDestroy*` / `ResearchCommand`
  commands, and `CommandRegistry` / `ToolRegistry` / `withForgePrefix` live in
  `packages/core/src/{commands,registry}/`. The "(stay in cli per the issue
  tree)" framing in the Context no longer holds.
- **R-S2 - the command seam is dissolved.** The structural
  `CommandRegistryLike` / `ToolRegistryLike` / `WorkspaceManagerLike`
  surfaces, the `CreateOrchestratorCommand` factory type, and the single
  documented `as never` cast are gone: commands are core now, so
  `FlowRegistrar` constructs `OrchestratorCommand` directly with concrete
  core types, and the composition root only wires the remaining seam.
- **R-S3 - test-utils moved to core.** `packages/core/src/test-utils.ts`
  hosts the shared test helpers (cli's file is a re-export shim). The
  "core tests import cli's test-utils until S11" interim is resolved; only
  three core test files construct cli D3 tool classes as fixtures
  (`RoutineTool` in `FlowRegistrar.test.ts` and `flow-roundtrip.test.ts`,
  `SetSessionNameTool` in `SessionAgent.test.ts`), covered by the eslint
  test-file exemption.
- **What remains** - only the `createRoutineTool` factory seam. `RoutineTool`
  stays cli-owned because it renders with pi-tui (D3/D4) and is wired at the
  composition root as `(…) => new RoutineTool(…)`. The transient type-only
  production imports named in the Decision also self-healed: `event-bus`,
  executors, and workspace are core since S4d/S4e, so no production
  core -> cli import remains.

## Context

Issue #229 relocates the flow engine from the cli package into core so the
cli package becomes a thin composition root (issue AC2/AC3 layering). The
flow engine (`flows/*`, `routines/*`) depends on collaborators that stay in
cli until later batches of the same issue:

- `CommandRegistry`, `ToolRegistry` (stay in cli per the issue tree -
  superseded: moved to core in the rework, R-S1),
- `RoutineTool`, `OrchestratorCommand` (cli concretions - superseded:
  `OrchestratorCommand` moved to core in the rework, R-S2; `RoutineTool`
  remains cli-owned, D3),
- `StepExecutorRegistry`, `TypedEventBus`, `WorkspaceManager` (move to core
  in S4d / S4e). `WorkspaceHandle` moved early, with S4d: it is a zero-import
  value object and its value import from `WorkspaceStepExecutor` would have
  been the first production _runtime_ core -> cli edge (cli's workspace barrel
  re-exports it from core until S4e moves the rest of the dir).

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
  (Superseded: dissolved in the rework, R-S2.)
- `OrchestratorCommandDeps` is exported from core: core-owned collaborators
  use concrete types; cli-owned ones (`toolRegistry`, `workspaceManager`) are
  structural, typed by the members the cli `OrchestratorCommand` reads.
  (Superseded: dissolved in the rework, R-S2.)
- Two factory types on the context - `CreateRoutineTool` and
  `CreateOrchestratorCommand` - are wired at the cli composition root
  (`cli/src/index.ts`): `(…) => new RoutineTool(…)` and
  `(deps) => new OrchestratorCommand(deps)`. The single documented `as never`
  cast there bridges core's structural deps and cli's concrete command deps.
  (Superseded: `CreateOrchestratorCommand` and the cast are dissolved in the
  rework, R-S2; `createRoutineTool` remains the only seam.)
- Transient core -> cli imports in moved production files are type-only
  (elided at emit, zero runtime edge) and each carries a comment naming the
  batch that self-heals it (S4d: `eventBus`, `StepExecutorRegistry`; S4e:
  workspace/ipc). Tests also import cli values at runtime until those batches.
  (Superseded: the production imports self-healed with S4d/S4e - those
  collaborators are core now; tests import core's test-utils, R-S3.)

## Consequences

- The flow engine's production code is cli-agnostic at runtime; cli supplies
  concretions at the composition root (DIP/ISP).
- The structural surfaces must track cli usage - the `as never` cast is a
  latent type hole if the two shapes drift; narrowing it (e.g. having
  `OrchestratorCommand` accept `ToolRegistryLike`) is planned when S4d moves
  the registries. (Superseded: the surfaces and cast are dissolved, R-S2.)
- Core's unit tests import cli's test-utils at runtime until S11 moves them
  to core (test-only; does not ship). (Superseded: test-utils moved to core
  in the rework, R-S3.)
- S11's restricted-imports lint will enforce the direction (core never imports
  cli) once the rules land with this series (issue section 8; not yet present).
  (Superseded: the rules landed with the rework - `packages/core` and
  `packages/debug` `eslint.config.js` forbid `@feature-forge/cli` (core also
  `@earendil-works/pi-tui`), with a test-file exemption for the three D3
  tool-class fixtures.)
- ADR 0018 was reserved by the phase plan for S10's package-layering
  decisions (D1-D8) but was never written; those decisions landed as
  ADR 0020. This ADR covers the S4c seam only.
