# ADR 0016: IpcTool base class for agent IPC tools

**Date:** 2026-08-18
**Status:** Accepted

## Context

The five agent-management tools (`SendTaskTool`, `SpawnAgentTool`,
`GetAgentResultTool`, `ListAgentsTool`, `DestroyAgentTool`) all proxy a
request to the child process over the IPC socket. Each one duplicated the
same skeleton: the null-client guard (returning the "Not available in
orchestrator mode" error), the abort check, request dispatch through the
client, result stringification, and the single error-details shape for
failures. Any change to that flow (for example the `ChildSocketClient`
lifecycle hardening in 3.13, or the error shape) had to be repeated across
five files.

The base class must live in `shared`, not `cli`, so the error shape and
client contract are usable from any package. `shared` cannot import the
cli package's wire types (`SocketMessage`), so the client dependency has to
be described structurally rather than by a concrete class.

## Decision

Add an abstract `IpcTool<TParams, TResult>` base class to
`packages/shared/src/tools/IpcTool.ts`:

- **`IpcRequestClient` structural interface** - a client exposing
  `request(type, params, timeout?, signal?)`. The cli's `ChildSocketClient`
  satisfies it structurally; method-signature bivariance keeps its generic
  `request` assignable to this signature, so no type assertions are needed
  at the call site.
- **Skeleton in `IpcTool.ipc()`** - the null-client guard, abort checks,
  request dispatch, result stringification, and the shared error-details
  shape (`{ error: string }`). The base `execute` delegates to `ipc` with no
  timeout.
- **Concrete tools declare only their schema and renderers** - plus a
  one-line `execute` override when a non-default timeout is needed
  (`SendTaskTool` threads `params.timeout` through).
- **`NO_CLIENT_ERROR` is a readonly literal** (`as const`) exported from the
  shared package, pinning the compile-time shape `{ error: "Not available in
orchestrator mode" }`; the reference itself is shared across null-client
  results, so callers must not mutate `details`.

The base `execute` takes `params: unknown` rather than a generic `P`: TypeScript
rejects generic-method overrides with narrower parameter types, so `unknown`
plus a single override is the compatible shape.

## Consequences

- **Five tools shrink to schema + renderers + one-line `execute`**; the
  duplicated null-client guard, abort checks, dispatch, and error shaping
  live in one place. The `ChildSocketClient` lifecycle changes (3.13) now
  benefit every IPC tool automatically.
- **Centralized error-shape coverage** in `IpcTool.test.ts` (null client,
  `Error` rejections, non-`Error` rejections, abort-before-dispatch, timeout
  and signal threading) with per-tool tests kept for behavior pinning.
- **Behavior-preserving extraction** - pre-existing behaviors carried over
  unchanged: the abort-swallow (a null client with an already-aborted signal
  throws `AbortError` before returning the error) and the structural
  bivariance on `IpcRequestClient` are documented, not altered.
- **New public API in `shared`** - `IpcTool`, `IpcRequestClient`, and
  `NO_CLIENT_ERROR` are exported from the package barrel, which is why this
  ADR exists (AGENTS.md requires an ADR for new public APIs).
- **Clients stay concrete** - nothing in `cli` depends on the interface;
  `ChildSocketClient` is passed as-is. If the wire types ever move into
  `shared`, the structural contract can be replaced by the real type without
  touching consumers.

## References

- ADR 0007 - Agent hierarchy: subprocess vs in-session (the IPC transport)
- Roadmap item 3.4 (Phase 0b) - IpcTool base class
- Source: `packages/shared/src/tools/IpcTool.ts`,
  `packages/shared/src/tools/IpcTool.test.ts`,
  `packages/cli/src/tools/SendTaskTool.ts`,
  `packages/cli/src/tools/SpawnAgentTool.ts`,
  `packages/cli/src/tools/GetAgentResultTool.ts`,
  `packages/cli/src/tools/ListAgentsTool.ts`,
  `packages/cli/src/tools/DestroyAgentTool.ts`
