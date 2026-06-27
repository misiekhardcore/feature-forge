# ADR 0004: Loader resilience and flow asset packaging

**Date:** 2026-06-26
**Status:** Accepted

## Context

Two robustness gaps in the flow loader:

1. **`loadAll` aborts on first error** — If one flow JSON is invalid (e.g.,
   a user-added flow with a typo), the entire extension fails to load,
   including `/implement`. One bad flow bricks everything.

2. **Flow JSON files not copied to dist** — `tsc` emits `.js` but not `.json`
   assets. At runtime, the compiled `index.ts` resolves `flowsDir` relative to
   `__dirname` which will be `dist/`, but `src/flows/*.json` won't be there.

## Decision

### E.1 — `loadAll` returns `{ flows, failures }`

The return type changes from `Promise<Map<string, FlowDefinition>>` to:

```typescript
Promise<{
  flows: Map<string, FlowDefinition>;
  failures: Map<string, Error>;
}>;
```

Individual `this.load(name)` calls are wrapped in try/catch. On failure, the
error is collected in `failures` and logged at warn level. The caller
(in `index.ts`) decides what to do — if the orchestrator flow (e.g.,
`implement`) is in `failures`, the extension can throw; otherwise it registers
the good flows and optionally logs the bad ones.

`scripts/validate-flow.ts --all` was updated to report both counts and exit
non-zero when failures exist.

### E.2 — Build-time asset copy + dist-relative resolution

A new `npm run build` script was added:

```json
"build": "tsc && npx tsx scripts/copy-assets.ts"
```

`scripts/copy-assets.ts` copies `src/flows/*.json` → `dist/flows/*.json`.

The wiring in `index.ts` (future todo #14) will resolve flows from:

```typescript
const flowsDir = path.join(__dirname, "flows");
```

Same pattern as specs already uses. The compiled `dist/orchestrator/index.js`
has `__dirname = dist/orchestrator/`, so `flows` → `dist/flows` — matches
the copy target.

`vitest.config.ts` now excludes `dist/**` so compiled JS doesn't pollute the
test run (it tried to load flows from `dist/src/flows/` which don't exist).

## Consequences

| File                                       | Change                                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `FlowLoader.ts`                            | `loadAll` returns `{ flows, failures }` with per-flow try/catch                         |
| `FlowLoader.test.ts`                       | New tests: one-valid-one-invalid returns both, empty dir, non-JSON filtered             |
| `scripts/validate-flow.ts`                 | `--all` handles `{ flows, failures }`, reports failures with exit code                  |
| `scripts/copy-assets.ts`                   | New: copies `src/flows/*.json` → `dist/flows/*.json`                                    |
| `package.json`                             | Added `build` script                                                                    |
| `vitest.config.ts`                         | Excludes `dist/**`                                                                      |
| `src/index.ts`                             | TODO comment for future flowsDir wiring                                                 |
| `PLAN.md` / `UPDATED_FLOW_ARCHITECTURE.md` | Referenced for the carried-forward rationale (`docs/flow-engine.md` removed 2026-06-27) |
