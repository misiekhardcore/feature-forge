# ADR 0023: Tool-owned rendering with the RenderableTool contract

**Date:** 2026-09-02
**Status:** Accepted

## Context

`ToolRenderer` historically accumulated per-tool `renderCall`/`renderResult`
statics plus a per-tool background-color map for seven tools
(`spawn_agent`, `send_task`, `get_agent_result`, `destroy_agent`,
`list_agents`, `set_flow_param`, `set_session_name`) - centralizing per-tool
presentation (backgrounds, header colors/text) in a shared module. Every
change to one tool's look had to be made inside the renderer module, and the
renderer knew details about tool internals it had no business knowing.

pi's `ToolDefinition` declares `renderShell`/`renderCall`/`renderResult`
optional, and the repository's core `Tool` base class does not declare them
at all - so a tool could silently lose boxed rendering. Issue #232 was
exactly that regression: after #218 replaced its routine tool with a plain
`Tool`, `set_flow_param` fell back to plain text rendering because nothing
declared the renderer pair.

User feedback during the rework of PR #250 sharpened the direction:
`ToolRenderer` must not store per-tool implementation details or values -
general-purpose methods only; each tool owns its rendering and its values;
introduce an interface that CLI tools implement; do not replace strong
parameter types with `unknown`.

A cross-typebox constraint surfaced during the rework: the repository's
`typebox` and pi's bundled nested `typebox` (under
`@earendil-works/pi-coding-agent/node_modules`) produce structurally
incompatible `Static` types, so typing the core `Tool.execute` signature as
`Static<TParams>` breaks its `implements ToolDefinition` check. Typed
execute params therefore come from the pre-existing bare-`Tool` plus
typed-override pattern: concrete tools declare `params: Static<schema>`
themselves.

## Decision

1. **`ToolRenderer` is a general-purpose static-only toolkit** (ADR 0017
   shape, private constructor): `shell` (boxed shell with
   truncation/expand), `header`, `simpleResult` (checkmark/error row,
   `details.error` plus `context.isError` aware), `messageResult`
   (confirmation-message row, `isError` aware), and exported types
   (`ToolBgColor`, `ToolShellState`, `ToolRenderContext` - the
   state/expanded/isError subset of pi's context - and `ToolShellBuilder`).
   No per-tool statics, no background map.
2. **Each TUI-rendered CLI tool implements the cli-local
   `RenderableTool<TParams, TDetails>` contract** (exported from
   `ToolRenderer.ts`): `renderShell: "self"`, a typed
   `renderCall(args: Static<TParams>, theme, context)`, and a typed
   `renderResult(result: AgentToolResult<TDetails>, options, theme,
context)`. The `implements` clause makes omission or local signature
   drift a compile error, closing the #232/#218 regression class - a tool
   can no longer declare `renderShell: "self"` without a renderer pair.
   Conformance is enforced against this local contract (a structural subset
   of pi's `ToolDefinition`) rather than pi's own exported type, because
   tools are registered through the base core `Tool`; pi-side renderer API
   drift is caught at runtime by pi's renderer fallback (documented seam).
3. **Renderer arguments are typed from each tool's own TypeBox schema** via
   module `Static` aliases; every per-tool value (background color, header
   colors/text, message formats) lives inside the tool's own
   `renderCall`/`renderResult` implementation.
4. **Result rows use one of two generic styles**: `simpleResult` for opaque
   IPC payloads (partial -> empty row, `details.error` -> error row,
   `context.isError` -> error row, else a muted checkmark) and
   `messageResult` for confirmation content in the success color
   (`isError`-aware). The set tools use `messageResult`; the five IPC tools
   use `simpleResult`.
5. **Strong param types where a tool consumes them**: `execute` overrides
   type `params` from the tool's own schema via module `Static` aliases
   wherever the body reads the arguments locally - `set_flow_param` and
   `set_session_name` declare `params: SetFlowParamArgs` /
   `SetSessionNameArgs`, and `send_task` types its override with the IPC
   wire interface `SendTaskParams` (from `@feature-forge/core/ipc`, needed
   to forward the per-call `timeout`). The four remaining IPC tools
   (`spawn_agent`, `get_agent_result`, `destroy_agent`, `list_agents`) add
   no local execute body, so they inherit the `IpcTool` base forwarding
   signature whose `params: unknown` sits behind the typed wire-message
   boundary - no `unknown` is introduced where a strong local type is
   available. `RoutineTool` remains a documented exception: it implements
   pi's `ToolDefinition` directly with its own progress-widget rendering
   and does not use `RenderableTool`.

## Consequences

- **Adding a new rendered tool** means implementing `RenderableTool` with
  self-owned renderers; `ToolRenderer` stays untouched (open/closed).
- **TUI rendering tests live beside each tool** (shared
  `makeTheme`/`makeRenderContext`/`makeRenderOptions`/`renderLines` helpers
  in `packages/cli/src/test-utils.ts`); `ToolRenderer.test.ts` covers the
  general helpers.
- **Visual output is preserved exactly** - per-tool migrations were
  verified byte-for-byte against the old statics during the rework.
- **`simpleResult`/`messageResult` now handle pi-level errors**
  (`context.isError`) instead of rendering the muted success marker for
  aborted or errored rows.

## References

- ADR 0015 - shared `set_flow_param` tool (Active-flow routing)
- ADR 0016 - `IpcTool` base class for agent IPC tools
- ADR 0017 - static utility classes (the `ToolRenderer` shape precedent)
- Issue #232 - set_flow_param/set_session_name boxed rendering regression
- Source: `packages/cli/src/tui/views/ToolRenderer.ts`,
  `packages/cli/src/tools/*Tool.ts` (seven tools),
  `packages/cli/src/test-utils.ts`
