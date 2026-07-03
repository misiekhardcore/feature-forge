# ADR 0009: Progress Reporter Port and TUI Adapter

**Status:** Accepted
**Date:** 2026-07-04
**Decision-makers:** Build agent

## Context

Routine execution (via `RoutineTool`) produces progress events on the feature-forge event bus (`feature-forge:*` channel). The orchestrator LLM already receives these as `onUpdate` callbacks (text-only), but there is no TUI-visible progress surface.

Issue #43 introduced the event bus for structured progress events. The remaining gap is rendering those events onto TUI surfaces (widget, status bar, tool row) so the user can see routine progress at a glance while interacting with the agent.

## Decision

Introduce a `ProgressReporter` abstraction port with two implementations:

1. **`ProgressReporter`** (abstract) — declares `update(event)` and `clear()`, plus a `getState()` snapshot method for external consumers
2. **`TuiProgressReporter`** — drives three TUI surfaces:
   - **Widget** ("forge-run", `placement: "aboveEditor"`) — multi-line panel showing routine name, iteration badge, per-agent status rows with theme-colored icons, continueWhile expression, and workspace path
   - **Status** ("feature-forge") — compact one-liner footer status with routine name, iteration counter, and agent status icons
   - **`onStateChange` callback** — lets `RoutineTool` call `context.invalidate()` for its tool-row `renderCall`
3. **`NoOpProgressReporter`** — empty implementation for non-TUI environments (RPC mode, child sessions, etc.)

`RoutineTool` is updated to:

- Detect TUI availability (`ctx.ui`) and instantiate the appropriate reporter
- Extract `maxIterations` and `continueWhile` from the routine's loop instruction
- Subscribe to `feature-forge:*` events and convert `RoutineProgressEvent` → `ProgressEvent` → `reporter.update()`
- Add `renderCall` and `renderResult` methods for compact tool-row rendering
- Clean up on completion via `reporter.clear()` in the `finally` block

### Widget placement

`aboveEditor` was chosen over `belowEditor` because:

- The widget is always visible regardless of scroll position in the chat
- It doesn't interfere with streaming assistant messages below the editor

### Footer status

A persistent one-liner in the footer bar, keyed as `"feature-forge"`. Uses `theme.fg("accent")` for the routine icon, `theme.fg("success")` for done agents, `theme.fg("warning")` for running agents, `theme.fg("error")` for failed agents, and `theme.fg("muted")` for idle agents.

### Tool row

`renderCall` shows `⟳ routineName · pending` before execution starts. `renderResult` shows `✓ routineName · passed` or `✗ routineName · failed`. During execution, the `onStateChange` callback triggers `context.invalidate()` so the row updates dynamically with agent status.

### NoOp default

`NoOpProgressReporter` is used when `ctx.ui` is unavailable. This ensures orchestrators running in child sessions or RPC mode don't break — no TUI imports leak into the orchestrator core.

### Throttling strategy

Widget renders are throttled to ~4/s (250ms minimum interval):

- First event renders immediately
- Subsequent events within 250ms are coalesced; only a single deferred render is scheduled
- Status updates are NOT throttled (they are cheap single-line renders)
- The 250ms interval balances responsiveness against TUI layout thrashing

## Consequences

### Positive

- TUI users get live routine progress via widget, status bar, and tool row
- Non-TUI environments continue to work unchanged via `NoOpProgressReporter`
- `ProgressReporter` is an extensible port — new rendering targets can be added without touching `RoutineTool`
- No TUI imports leak into orchestrator core types
- Event bus → ProgressReporter conversion is cleanly separated in `RoutineTool.toProgressEvent()`

### Negative

- `RoutineTool` now has additional responsibility (progress wiring), making it slightly larger
- Widget render factory captures theme and state in a closure; if TUI context changes (theme switch) while a routine is running, the widget won't pick up the new theme until the next render cycle
- `ThrottleTimer` in TuiProgressReporter is a `setTimeout` side effect that must be cleaned up in `clear()`

## Alternatives considered

1. **Render progress entirely in `onUpdate` callbacks**: The pi coding agent's `onUpdate` already passes text updates to the LLM. We could drive TUI surfaces from there, but `onUpdate` is optional (undefined when no LLM subscription). This would couple progress rendering to LLM subscription state.

2. **Progress as a standalone tool**: Making progress a separate tool the orchestrator calls would add unnecessary indirection and tool execution overhead.

3. **Event-driven widget updates without a reporter port**: Directly calling `ctx.ui.setWidget` from `RoutineTool.execute` would work but make testing and non-TUI fallback harder. The port abstraction keeps concerns separated.
