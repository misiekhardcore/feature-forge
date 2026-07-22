# Plan: Extract TUI rendering package

**Status:** Draft  
 **Date:** 2026-07-21  
 **Issue:** #168

## Goal

Create a new `packages/tui/` turbo package and move all visual rendering components,  
 agent viewer views, display helpers, and agent viewer state out of  
 `packages/cli/src/orchestrator/progress/` into the new package. The CLI package  
 retains only orchestrator domain logic — step executors, display contributions,  
 progress events, and the routine tool.

## Target architecture

```
packages/
├── shared/     ← (unchanged) shared utilities, JSON parsing
├── tui/        ← NEW: rendering primitives, views, state, display helpers
├── cli/        ← domain logic, step executors, progress events, routine tool
├── debug/      ← (unchanged)
├── web/        ← (unchanged)
└── eslint-config/ ← (unchanged)
```

Dependency direction: `cli → tui → shared` (no cycles).

## Interface design principles

1.  **No `I` prefix.** Interfaces are named by role: `AgentEntryProvider`, not `IAgentEntryProvider`.
2.  **Subset interfaces, not redefinitions.** Each interface captures only the methods a  
    specific tui consumer actually calls. CLI classes (e.g., `AgentSupervisor`,  
    `TypedEventBus`, `ForgeConfig`) satisfy these interfaces structurally — no  
    `implements` clause needed.
3.  **No shared-types pollution.** Concrete types like `TypedEventBus`,  
    `AgentSupervisor`, and `ForgeConfig` cannot move to `shared` because they pull  
    domain-heavy dependencies (`ForgeChannels`, `Agent`, `SubprocessAgent`,  
    `InSessionAgent`, TypeBox schemas). Subset interfaces in tui avoid this.
4.  **Granular interfaces.** Each view declares exactly the interface union it needs.  
    No consumer sees methods it doesn't call.

## Interface definitions

All interfaces live in `packages/tui/src/api.ts`.

### Agent state (consumed by AgentListView, AgentDetailView, AgentViewerOverlay)

```ts
interface AgentEntryProvider {
  getAgentEntry(id: string): AgentViewerEntry | undefined;
  getAgentEntries(): ReadonlyMap<string, AgentViewerEntry>;
  getAgentIds(): string[];
  get entryCount(): number;
}

interface AgentStreamProvider {
  getLastLine(agentId: string): string | undefined;
  get lastStreamLine(): string;
}

interface AgentConversationProvider {
  getConversationMessages(agentId: string): AgentMessage[];
  loadConversationEvents(
    agentId: string,
    count?: number,
  ): Promise<AgentEvent[]>;
}

interface AgentStateWriter {
  update(entry: AgentViewerEntry): void;
  pushStreamEvent(
    agentId: string,
    event: AgentEvent,
    formatEvent: (e: AgentEvent) => string,
  ): void;
  setStreamDir(dir: string): void;
  dispose(): void;
}
```

### Overlay wiring (consumed by AgentViewerOverlay.wireOverlayEvents)

```ts
interface AgentQuery {
  getAgent(id: string):
    | {
        specification: { role: string };
        status: string;
        createdAt: Date;
      }
    | undefined;
  getAllAgents(): Array<{
    id: string;
    specification: { role: string };
    status: string;
    createdAt: Date;
  }>;
}

interface EventSubscriber {
  on(channel: string, handler: (payload: unknown) => void): () => void;
}

interface DisplayConfig {
  getDisplayMaxAgentEvents(): number;
  getDisplayMaxPreconnectBuffer(): number;
  getDisplayMaxOverlayHeight(): string;
}
```

### Tool rendering (consumed by ConversationRenderer)

```ts
interface ToolFormatter {
  getDescription(name: string): string | undefined;
}
```

## Interface to consumer matrix

| Interface                   | ListView | DetailView | Overlay      | ConvRenderer | ProgressRenderer |
| --------------------------- | -------- | ---------- | ------------ | ------------ | ---------------- |
| `AgentEntryProvider`        | yes      | yes        | yes          |              |                  |
| `AgentStreamProvider`       | yes      |            | yes          |              |                  |
| `AgentConversationProvider` |          | yes        |              |              |                  |
| `AgentStateWriter`          |          |            | yes          |              |                  |
| `AgentQuery`                |          |            | yes (static) |              |                  |
| `EventSubscriber`           |          |            | yes (static) |              |                  |
| `DisplayConfig`             |          |            | yes (static) |              |                  |
| `ToolFormatter`             |          |            |              | yes          |                  |
| Progress interfaces         |          |            |              |              | yes              |

## File mapping

### Move to `packages/tui/`

| Source (cli)                          | Destination (tui)                     | Interface deps added                                                                                                                         |
| ------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `progress/types/` (5 files)           | `src/types/`                          | none                                                                                                                                         |
| `progress/BorderedContainer.ts`       | `src/components/BorderedContainer.ts` | none                                                                                                                                         |
| `progress/ScrollableBox.ts`           | `src/components/ScrollableBox.ts`     | none                                                                                                                                         |
| `progress/AgentDisplayHelpers.ts`     | `src/display/AgentDisplayHelpers.ts`  | none                                                                                                                                         |
| `progress/AgentListView.ts`           | `src/views/AgentListView.ts`          | `AgentEntryProvider & AgentStreamProvider`                                                                                                   |
| `progress/AgentDetailView.ts`         | `src/views/AgentDetailView.ts`        | `AgentEntryProvider & AgentConversationProvider`                                                                                             |
| `progress/AgentViewerOverlay.ts`      | `src/views/AgentViewerOverlay.ts`     | `AgentEntryProvider & AgentStreamProvider & AgentStateWriter`; static method: `AgentQuery & EventSubscriber & DisplayConfig & ToolFormatter` |
| `progress/AgentViewerState.ts`        | `src/state/AgentViewerState.ts`       | none                                                                                                                                         |
| `progress/ConversationRenderer.ts`    | `src/views/ConversationRenderer.ts`   | `ToolFormatter`                                                                                                                              |
| `progress/ProgressRenderer.ts`        | `src/progress/ProgressRenderer.ts`    | `DisplayRegistry` + progress state interfaces                                                                                                |
| `progress/TuiProgressReporter.ts`     | `src/progress/TuiProgressReporter.ts` | none (already pure TUI)                                                                                                                      |
| `progress/ProgressWidget` (extracted) | `src/progress/ProgressWidget.ts`      | none                                                                                                                                         |
| All `*.test.ts` for above             | co-located with sources               | same                                                                                                                                         |

### Stay in `packages/cli/src/orchestrator/progress/`

| File                             | Reason                                                               |
| -------------------------------- | -------------------------------------------------------------------- |
| `AccumulatedState.ts`            | Domain state accumulation for progress rendering                     |
| `DisplayContribution.ts`         | Orchestrator contribution DTO                                        |
| `DisplayContributionRegistry.ts` | Orchestrator contribution dispatch                                   |
| `NoOpProgressReporter.ts`        | Non-TUI fallback progress reporter                                   |
| `ProgressReporter.ts`            | Abstract progress reporter class (after extracting `ProgressWidget`) |
| `ProgressEvent.ts`               | Domain DTO for progress events                                       |
| `RoutineProgressState.ts`        | Orchestrator state interface                                         |
| `sharedStreamDir.ts`             | Stream directory management                                          |
| `index.ts`                       | Barrel re-exports (updated to re-export from `@feature-forge/tui`)   |

### CLI import updates

| Consumer                  | Old import                                                  | New import                          |
| ------------------------- | ----------------------------------------------------------- | ----------------------------------- |
| `RoutineTool.ts`          | `from "./progress/AgentViewerOverlay"`                      | `from "@feature-forge/tui"`         |
| `RoutineTool.ts`          | `from "./progress/ProgressRenderer"`                        | `from "@feature-forge/tui"`         |
| `RoutineTool.ts`          | `from "./progress/TuiProgressReporter"`                     | `from "@feature-forge/tui"`         |
| `RoutineTool.ts`          | `from "./progress/ProgressReporter"` (for `ProgressWidget`) | `from "@feature-forge/tui"`         |
| `AgentListCommand.ts`     | `from "../orchestrator/progress/AgentViewerOverlay"`        | `from "@feature-forge/tui"`         |
| `registerTestCommands.ts` | `from "../orchestrator/progress/AgentViewerOverlay"`        | `from "@feature-forge/tui"`         |
| `registerTestCommands.ts` | `from "../orchestrator/progress/ProgressRenderer"`          | `from "@feature-forge/tui"`         |
| `registerTestCommands.ts` | `from "../orchestrator/progress/TuiProgressReporter"`       | `from "@feature-forge/tui"`         |
| `registerTestCommands.ts` | `from "../orchestrator/progress/types"`                     | `from "@feature-forge/tui"`         |
| `orchestrator/index.ts`   | various `from "./progress/..."`                             | re-export from `@feature-forge/tui` |
| All step executors        | `from "../progress/DisplayContribution"` etc.               | unchanged (stays in CLI)            |

## AgentViewerOverlay.wireOverlayEvents signature change

**Before** (imports concrete CLI types):

```ts
static wireOverlayEvents(params: {
  eventBus: TypedEventBus;
  supervisor: AgentSupervisor;
  config: ForgeConfig;
  toolRegistry: ToolRegistry;
  streamDir: SharedStreamDir;
  markdownTheme: MarkdownTheme;
}): { connect: ...; unsubs: ... };
```

**After** (accepts subset interfaces, callers pass concrete objects):

```ts
static wireOverlayEvents(params: {
  eventBus: EventSubscriber;
  supervisor: AgentQuery;
  config: DisplayConfig;
  toolRegistry: ToolFormatter;
  streamDir: SharedStreamDir;
  markdownTheme: MarkdownTheme;
}): { connect: ...; unsubs: ... };
```

`TypedEventBus` structurally satisfies `EventSubscriber` (has `on()` returning unsubscribe).  
 `AgentSupervisor` structurally satisfies `AgentQuery` (has `getAgent()`, `getAllAgents()`).  
 `ForgeConfig` structurally satisfies `DisplayConfig` (has the three getters).  
 `ToolRegistry` structurally satisfies `ToolFormatter` (has `getDescription()`).

No CLI types are imported by tui. No redefinitions — each interface captures a narrower  
 contract for a narrower consumer.

## ProgressWidget extraction

`ProgressReporter.ts` currently contains both:

- `ProgressWidget` interface (3 lines — purely TUI)
- `ProgressReporter` abstract class (CLI domain)
- `ProgressSnapshot` interface + `EMPTY_PROGRESS_SNAPSHOT` (CLI domain)

Extract `ProgressWidget` into `packages/tui/src/progress/ProgressWidget.ts`:

```ts
export interface ProgressWidget {
  render(lines: string[], status: string): void;
  clear(): void;
}
```

The `ProgressReporter` abstract class and `ProgressSnapshot` stay in CLI.

## Package scaffold

`packages/tui/package.json`:

```json
{
  "name": "@feature-forge/tui",
  "version": "0.1.0",
  "private": true,
  "description": "Feature Forge TUI - rendering components, views, and display helpers",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "echo 'tui: nothing to build'",
    "test": "vitest run",
    "lint": "eslint .",
    "lint:fix": "eslint --fix .",
    "format": "prettier . --check",
    "format:fix": "prettier . --write",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@earendil-works/pi-agent-core": "0.79.10",
    "@earendil-works/pi-coding-agent": "0.79.8",
    "@earendil-works/pi-tui": "0.79.8",
    "@feature-forge/shared": "*"
  },
  "devDependencies": {
    "@feature-forge/eslint-config": "*"
  }
}
```

Add to `packages/cli/package.json`:

```json
"dependencies": {
  "@feature-forge/tui": "*",
  ...
}
```

Add to `vitest.workspace.ts`:

```ts
{
  test: {
    name: "tui",
    root: "./packages/tui",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
},
```

## Implementation phases

### Phase 1 — Scaffold the package

- Create `packages/tui/` directory with `package.json`, `tsconfig.json`, `.eslintrc.cjs`
- Add `@feature-forge/tui` to CLI's `package.json` dependencies
- Add tui project to `vitest.workspace.ts`
- Verify: `npm install` resolves, empty package typechecks

### Phase 2 — Move types

- Move `types/AgentEntryBase.ts`, `RunningAgentEntry.ts`, `CompletedAgentEntry.ts`, `ErroredAgentEntry.ts`, `types/index.ts` to `packages/tui/src/types/`
- Update internal imports within types (still relative, same directory)
- Verify: tui package typechecks

### Phase 3 — Move pure components

- Move `BorderedContainer.ts` + test to `packages/tui/src/components/`
- Move `ScrollableBox.ts` + test to `packages/tui/src/components/`
- Update imports: `@earendil-works/pi-tui` stays, `@earendil-works/pi-coding-agent` stays
- Verify: component tests pass in tui project

### Phase 4 — Move display helpers

- Move `AgentDisplayHelpers.ts` + test to `packages/tui/src/display/`
- Update `AgentViewerEntry` import from `../types` (now same package)
- Verify: tests pass

### Phase 5 — Define interfaces (`api.ts`)

- Create `packages/tui/src/api.ts` with all interfaces listed above
- No implementation, no tests needed — just types
- Verify: typecheck

### Phase 6 — Move AgentViewerState

- Move `AgentViewerState.ts` + test to `packages/tui/src/state/`
- Update imports: `AgentViewerEntry` from `../types`, `jsonParse` from `@feature-forge/shared`
- CLI-side consumers now import `AgentViewerState` from `@feature-forge/tui`
- Update `registerTestCommands.ts`: `viewer.update()` calls now type-check against tui types
- Verify: state tests pass

### Phase 7 — Move views

- Move `AgentListView.ts` + test to `packages/tui/src/views/`
  - Replace `AgentViewerState` param with `AgentEntryProvider & AgentStreamProvider`
  - Update test mocks to implement only those two interfaces
- Move `AgentDetailView.ts` + test to `packages/tui/src/views/`
  - Replace `AgentViewerState` param with `AgentEntryProvider & AgentConversationProvider`
  - Add `maxEvents: number` constructor param (extracted from config by CLI-side overlay)
  - Add conversation caching from #154
  - Update test mocks
- Move `ConversationRenderer.ts` + test to `packages/tui/src/views/`
  - Replace `ToolRegistry` param with `ToolFormatter`
  - Update test mocks
- Move `AgentViewerOverlay.ts` + test to `packages/tui/src/views/`
  - Replace domain imports with interface params
  - `wireOverlayEvents` signature changes as described above
  - Rendering tests move to tui; domain-wiring tests stay in CLI
- Verify: all view tests pass

### Phase 8 — Move progress rendering

- Extract `ProgressWidget` from `ProgressReporter.ts` to `packages/tui/src/progress/ProgressWidget.ts`
- Move `TuiProgressReporter.ts` + test to `packages/tui/src/progress/`
- Move `ProgressRenderer.ts` + test to `packages/tui/src/progress/`
  - Replace `DisplayContributionRegistry` with `DisplayRegistry` interface
  - Replace `RoutineProgressState` with subset interface
- Verify: tests pass

### Phase 9 — Update CLI imports and re-exports

- Update all CLI consumers (see table above) to import from `@feature-forge/tui`
- Update `orchestrator/index.ts` re-exports to source from `@feature-forge/tui`
- Remove moved files from CLI
- Verify: CLI typechecks, all tests pass

### Phase 10 — Full validation

- `npm run typecheck` from root — all packages clean
- `npm run lint` from root — all packages clean
- `npm test` from root — all tests pass
- Run `npm run fix` for auto-fixes, then re-verify

## Test migration note

`AgentViewerOverlay.test.ts` (~4200 lines, ~260 tests) gets split:

- Rendering tests (render output format, border structure, list/detail view behavior, handleInput, scroll) move to tui
- Event-wiring tests (wireOverlayEvents, connect, event buffer, supervisor integration) stay in CLI, updated to import overlay from `@feature-forge/tui` and pass concrete CLI objects

The wiring tests in CLI already pass concrete `makeMockSupervisor()`, `makeMockTypedEventBus()`,  
 `ForgeConfig.getInstance()` — these satisfy the new tui interfaces structurally. No mock  
 changes needed beyond import path updates.

## No shared-package changes

After analysis, no types genuinely need to move to `shared`:

- `AgentViewerEntry` depends on `AgentEvent` from `pi-agent-core` — tui already has this dep
- `TypedEventBus` depends on `ForgeChannels` (20+ event types) — too domain-heavy for shared
- `AgentSupervisor` depends on `Agent`, `Specification`, `SubprocessAgent`, `InSessionAgent` — too domain-heavy
- `ForgeConfig` is a TypeBox-schema singleton — not appropriate for shared
- The subset interfaces in tui are the correct abstraction — narrower contracts, no dependency drag

## Backward compatibility

The CLI's `orchestrator/index.ts` continues to re-export the same symbols  
 (`AgentViewerOverlay`, `ProgressRenderer`, `TuiRoutineWidget`, etc.), now sourced from  
 `@feature-forge/tui`. External consumers of `@feature-forge/cli` see no change.
