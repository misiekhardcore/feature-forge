# Plan: Fix Agent Details Overlay Performance

## Problem

The agent details overlay (`AgentViewerOverlay`) is extremely slow. Five distinct performance issues identified in `AgentViewerOverlay.ts` and `ConversationRenderer.ts`.

## Issues & Tasks

### 1. [ ] Replace `readFileSync` in `loadMessagesFromDiskIntoCache` with streaming readline + ring buffer

- **File:** `packages/cli/src/orchestrator/progress/AgentViewerOverlay.ts`
- **Method:** `loadMessagesFromDiskIntoCache`
- **Problem:** Reads the entire `.messages.jsonl` file synchronously with `readFileSync`, blocking the event loop at startup.
- **Fix:** Use `createReadStream` + `createInterface` with a ring buffer (last `MAX_AGENT_EVENTS` lines), matching the pattern in `loadConversationEvents`.
- **Note:** This method is private and synchronous (called from `prepopulateStreamFiles` which is synchronous). The caller will need to be adapted or this method made async with results assigned after the fact.

### 2. [ ] Add viewport-aware rendering to `ConversationRenderer.render`

- **File:** `packages/cli/src/orchestrator/progress/ConversationRenderer.ts`
- **Method:** `render`
- **Problem:** Creates a new `Container` and instantiates components for ALL 200 messages on every frame, then viewport clipping happens on the already-rendered lines.
- **Fix:** Accept optional `visibleRange?: { start: number; end: number }` parameter. When provided, only instantiate components for messages within (or near) the visible range. Outside-range messages contribute placeholder line counts for scroll offset computation. Alternatively, accept a `maxMessages` hint and stop component creation early.

### 3. [ ] Change `computeScrollMax` to estimate line count instead of performing a full render

- **File:** `packages/cli/src/orchestrator/progress/AgentViewerOverlay.ts`
- **Method:** `computeScrollMax`
- **Problem:** Calls `renderConversationTurns` — a full rendering of all messages — just to measure `.length`. Triggered on every scroll event during streaming.
- **Fix:** Use a heuristic: `estimatedLines = messageCount * avgLinesPerMessage` where `avgLinesPerMessage` is tracked incrementally as messages are actually rendered. When dirty, recompute via render once. When clean, use the cache.

### 4. [ ] Cache rendered conversation output and reuse it when unchanged

- **File:** `packages/cli/src/orchestrator/progress/AgentViewerOverlay.ts`
- **Method:** `renderDetail`
- **Problem:** `renderDetail` unconditionally calls `renderConversationTurns` every frame, even though `computeScrollMax` already maintains a `conversationLinesDirty` flag and `cachedConversationLineCount`. The cache is never used by `renderDetail`.
- **Fix:** Track a `cachedConversationLines: string[]` alongside the existing `cachedConversationLineCount`. When `conversationLinesDirty` is false, reuse the cached lines directly. Set dirty on `pushStreamEvent`.

### 5. [ ] Add a dirty/version tracker so `renderDetail` skips full re-render on frames with no new data

- **File:** `packages/cli/src/orchestrator/progress/AgentViewerOverlay.ts`
- **Fix:** The `conversationLinesDirty` flag already exists and is set by `pushStreamEvent`. This task is about wiring it through so `renderDetail` reads it and skips `renderConversationTurns` when clean. Combined with issue 4 above — once the rendered output is cached, the dirty flag gates re-rendering.

## Dependency Order

```
1 (readFileSync) ── independent, can be done first
2 (viewport-aware) ── independent but may conflict with 4/5
3 (computeScrollMax) ── depends on stable line counting after 2 or 4
4 (cache rendered output) ── core fix, enables 5
5 (dirty flag gating) ── depends on 4
```

Recommended order: **1 → 4 → 5 → 3 → 2** (or: 1 first, then 4+5 together, then 3, then 2 as optional optimization).

## Files Affected

| File | Issues |
|------|--------|
| `packages/cli/src/orchestrator/progress/AgentViewerOverlay.ts` | 1, 3, 4, 5 |
| `packages/cli/src/orchestrator/progress/ConversationRenderer.ts` | 2, 4 (interface change) |
| `packages/cli/src/orchestrator/progress/AgentViewerOverlay.test.ts` | All (test coverage) |
| `packages/cli/src/orchestrator/progress/ConversationRenderer.test.ts` | 2 (test coverage) |

## Validation

- `npm run fix && npm run lint && npm run typecheck && npm run test`
- Manual: open agent details overlay during a routine run, confirm responsiveness
