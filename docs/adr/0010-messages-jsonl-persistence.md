# ADR 0010: Messages JSONL Persistence (Finalized Messages, Not Raw Events)

**Status:** Accepted
**Date:** 2026-07-16
**Decision-makers:** Build agent

## Context

`AgentViewerOverlay` persists agent conversation data to disk during routine
execution so that `prepopulateStreamFiles` can restore agent histories when a
new overlay instance is opened (e.g. `/agent:list` on a routine that already
ran). The previous implementation persisted **raw streaming events** to
`{agentId}.events.jsonl` and loaded the entire file into memory at startup,
then re-extracted `AgentMessage` objects from those events on every render via
`getConversationMessages`.

This had three problems:

1. **Memory cost.** Loading every raw `message_start`, `message_update`, and
   `message_end` event into memory at startup duplicates the data already held
   in the in-memory `agentEvents` sliding window and grows linearly with
   conversation length.

2. **Per-render re-extraction.** `getConversationMessages` walked the raw
   event list and called `extractMessageFromEvent` on every render, even
   though the result is deterministic between events. This wasted CPU on each
   TUI frame.

3. **Divergence from pi.** pi itself persists **finalized messages** — its
   `appendMessage` writes exactly one `AgentMessage` entry per finalized
   message (on `message_end` for `user`/`assistant`/`toolResult`), never one
   entry per streaming update. feature-forge was reinventing the same
   finalization at read time instead of doing it once at write time.

Issue #144 aligned `ConversationRenderer` with pi's `AgentMessage`-based
rendering. Closing the persistence gap was the remaining piece.

## Decision

### Write finalized messages to `{agentId}.messages.jsonl`

`pushStreamEvent` now persists to `messages.jsonl` only on `message_end`
events whose message role is `user`, `assistant`, or `toolResult`. This
mirrors pi's `appendMessage` exactly: one entry per finalized message, never
per streaming update (`message_start` / `message_update` write nothing).

### Keep raw `events.jsonl` for diagnostics only

`pushStreamEvent` continues writing every raw event to
`{agentId}.events.jsonl` unchanged. However, `prepopulateStreamFiles` no
longer loads this file into memory at startup — the path is only registered in
`eventsFiles` so that `loadConversationEvents` can lazily read older events
from disk when a consumer requests more than the in-memory sliding window
holds. This preserves the existing lazy-load contract without the startup
memory cost.

### Cache extracted messages in `agentMessages`

A new `agentMessages` Map stores `AgentMessage[]` per agent. It is populated
two ways:

- **Live:** `appendMessageFromEvent` extracts the message on every
  `message_end` (and deduplicates `message_update` by replacing the last
  entry), so the cache is always current.
- **From disk:** `loadMessagesFromDiskIntoCache` reads `messages.jsonl` at
  startup and merges disk messages (older) with in-memory entries (newer),
  capped to `MAX_AGENT_EVENTS` keeping the most recent.

`getConversationMessages` now returns the cache directly — no per-render
re-extraction. `computeScrollMax` uses a `conversationLinesDirty` flag to
avoid recomputing line counts until a `pushStreamEvent` invalidates them.

### `turn_end` no longer special-cased

Pi delivers each `toolResult` as its own `message_start` / `message_end` pair
(via `emitToolResultMessage`), not via `turn_end`. The previous
`appendMessageFromEvent` special-cased `turn_end` to extract toolResults;
that branch is removed. The debug scenarios were rewritten to emit pi's real
event order so tests exercise the production code path.

### `loadConversationEvents` suffix invariant

`loadConversationEvents` relies on the in-memory `agentEvents` buffer being a
**suffix** of the full `events.jsonl` log (the most recent
`MAX_AGENT_EVENTS` events). At startup `agentEvents` is empty (raw events are
not loaded), so the invariant degrades to "last `count` lines from disk" — no
regression for cross-session historical agents.

## Consequences

### Positive

- Startup memory cost drops: only finalized messages are loaded, not every
  streaming event. A long conversation with 500 `message_update` events now
  loads 1 message instead of 501 events.
- Per-render CPU cost drops: `getConversationMessages` is an O(1) Map lookup.
- feature-forge's persistence model now matches pi's `appendMessage` — one
  source of truth for what "a message" is.
- Raw `events.jsonl` is preserved for diagnostics and lazy historical access
  without being loaded at startup.

### Negative

- Two JSONL files per agent on disk (`events.jsonl` + `messages.jsonl`) where
  there was one (`events.jsonl`). The messages file is strictly smaller (one
  entry per finalized message, not per streaming update).
- `loadConversationEvents` callers that relied on `agentEvents` being
  pre-populated from disk will get only the live session's events from memory.
  This is a behaviour change but the suffix invariant handles it correctly:
  when `count > memoryEvents.length`, older events are read from disk and
  prepended.

## Alternatives considered

1. **Keep raw events as the single source of truth, load lazily.** Would
   avoid a second file but require re-extraction on every disk read and every
   render. We chose to pay one write per finalized message to make reads O(1).

2. **Write messages.jsonl and delete events.jsonl entirely.** Would simplify
   to one file but lose raw event diagnostics (detailed streaming trace useful
   for debugging agent behaviour) and break the `loadConversationEvents` lazy
   contract used by external consumers.

3. **In-memory-only re-extraction, no persistence change.** Would fix
   per-render CPU but not the startup memory cost of loading all raw events,
   and would diverge from pi's model.
