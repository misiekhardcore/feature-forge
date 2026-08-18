# Phase 0 - Quick wins (architecture-review roadmap)

Base: `main` @ `714c209b` (Phase -1 PR #225 merged). This phase implements the roadmap's
"Phase 0 - Quick wins": dead code + hygiene (3.17), IpcTool base class (3.4),
FlowStateStore de-inheritance (3.8), workspace name/path fixes (3.11/3.12),
socket null guard (3.13), logger/console consistency (3.26 + 3.17#11).

## Current task
Subtask 9 done. Next: subtask 10 (Magic numbers, 3.17#12).

## Next action on resume
Run build loop for subtask 10 (Magic numbers: shell 120s, git 60s, maxBuffer 10MB, preconnect 2000 → ForgeConfigDefaults / named constants).

## AC checklist

| # | AC | Status |
|---|----|--------|
| 1 | 3.4 (P1-1): IpcTool base class; 5 agent tools shrink to schema + one-line execute | [x] |
| 2 | 3.8 (P1-5): FlowStateStore standalone class (get/set/entries/toObject, Map-backed), no `extends Registry` | [x] |
| 3 | 3.11 (P2-1): WorkspaceStepExecutor stores workspace under `instruction.id`, not `"ws"` | [x] |
| 4 | 3.12 (P2-2): WorkspaceManager `destroy`/`get` params renamed `path` + doc note (keys are paths) | [x] |
| 5 | 3.13 (P2-3): ChildSocketClient rejects immediately when socket null; pending registered before write; pending rejected on close; connect() guards double-connect | [x] |
| 6 | 3.26 (P2-9): ConsoleLogger level filtering; shared manifest yaml/typebox → dependencies, vitest → devDependencies | [x] |
| 7 | 3.17#11: console.warn/error → logger in ConfigLoader/spec-resolution/tool-restrictions | [x] |
| 8 | 3.17#26: DEFAULT_LOG_LEVEL deleted | [x] |
| 9 | 3.17#1: fillTemplate deleted (source + test + exports) | [x] |
| 10 | 3.17#4: DynamicAgentSpecification.toJSON override deleted | [x] |
| 11 | 3.17#6: duplicated class-level JSDoc in GitWorktreeProvider deduped | [x] |
| 12 | 3.17#7: orphaned docstring fragment in AgentViewerOverlay deleted | [x] |
| 13 | 3.17#20: dead avgLinesPerMessage map in AgentDetailView deleted | [x] |
| 14 | 3.17#15 (3.10#5): GitStepExecutor twin logger.debug dropped (eventBus.emit kept) | [x] |
| 15 | 3.17#21: em-dashes in user-facing display strings → hyphens (ProgressRenderer, AgentViewerOverlay, AgentDetailView) | [x] |
| 16 | 3.17#22: widget separator width includes icon width | [x] |
| 17 | 3.17#9: getOverlayOptions maxHeight typed `string`, no lying cast | [x] |
| 18 | 3.17#8: OrchestratorCommand docstring numbering fixed (1-4) | [x] |
| 19 | 3.17#10: RoutineTool renderCall context narrowed via local interface (no `any`/eslint-disable) | [x] |
| 20 | 3.17#19: TuiProgressReporter.ts renamed TuiRoutineWidget.ts (class name, test file, index) | [x] |
| 21 | 3.17#5: TOOL_PRESETS readOnly/reviewOnly deduped (alias) | [x] |
| 22 | 3.17#24: sharedStreamDir pruning extracted into one pruneByRetention() | [x] |
| 23 | 3.17#25: e2e helper socket setTimeout cleared on resolve; PROJECT_ROOT via fileURLToPath | [x] |
| 24 | 3.17#27: ForgeConfigSchema logLevel/workspaceProvider/agents/defaultAgent → Type.Optional (defaults supplied) | [x] |
| 25 | 3.17#28: packages/shared `npm run test` works (package-local vitest config) | [x] |
| 26 | 3.17#12: magic numbers → named constants (shell 120s, git 60s, maxBuffer 10MB, preconnect 2000) | [ ] |
| 27 | 3.17#13: manifest alignment - typebox 1.3.8 everywhere, TS 6.0.3 in debug, pi SDK pins consistent (contingent: revert pi bump if suite breaks) | [ ] |
| 28 | 3.17#14: packages/web placeholder deleted | [ ] |
| 29 | 3.17#16: FlowRegistrar single context object, no double destructuring | [ ] |
| 30 | 3.17#17: SkillResolver → plain functions + module-level constants | [ ] |
| 31 | 3.17#18: FlowLoader split - instance load/loadAll + flowValidation.ts pure functions | [ ] |

## Deferred (documented rationale)

- 3.17#2 buildEnvOverlay: Phase -1 added tests; kept as tested public API (review allows "test + use").
- 3.17#3 ConsoleLogger wiring: filtering added per 3.26; no `--console-logs` mode (out of quick-wins scope).
- 3.17#23 EventSubscriber: kept - Phase 1 (P0-1 fix) uses it at the tui/cli boundary.
- 3.17#13 pi SDK: attempt 0.79.8 → 0.79.10; revert and defer if the suite breaks.

## Subtask plan

All subtasks are independent (no overlapping files). Sequential execution in the single workspace.

| # | Subtask | Files (create/modify/delete) |
|---|---------|------------------------------|
| 1 | IpcTool (3.4) | +shared/src/tools/IpcTool.ts (+test), shared/src/index.ts, 5 tools in cli/src/tools/ |
| 2 | FlowStateStore (3.8) | FlowStateStore.ts, FlowStateStore.test.ts |
| 3 | Workspace fixes (3.11+3.12) | WorkspaceStepExecutor.ts (+test), WorkspaceManager.ts (+test) |
| 4 | ChildSocketClient (3.13) | ChildSocketClient.ts, ChildSocketClient.test.ts |
| 5 | Logger/console (3.26+#11+#26) | ConsoleLogger.ts (+test), shared/package.json, ConfigLoader.ts, spec-resolution.ts, tool-restrictions.ts, LogLevel.ts (+test), logging/index.ts, shared/index.ts |
| 6 | Dead code A | templates.ts+test (del), specifications/index.ts, agents/index.ts, DynamicAgentSpecification.ts, GitWorktreeProvider.ts, GitStepExecutor.ts (+test) |
| 7 | TUI strings B | ProgressRenderer.ts (+test), AgentViewerOverlay.ts (+test), AgentDetailView.ts, OrchestratorCommand.ts, RoutineTool.ts, TuiProgressReporter.ts→TuiRoutineWidget.ts (+test), constants.ts |
| 8 | Progress/e2e C | sharedStreamDir.ts (+test), e2e/helpers.ts |
| 9 | Schema + shared test script D | ForgeConfigSchema.ts (+test), ConfigLoader.test.ts, +packages/shared/vitest.config.ts |
| 10 | Magic numbers (3.17#12) | ShellStepExecutor.ts, GitStepExecutor.ts, registerSignalHandlers.ts |
| 11 | Manifests (#13+#14) | package.jsons (cli/shared/tui/debug), delete packages/web/, package-lock via npm install |
| 12 | FlowRegistrar (3.17#16) | FlowRegistrar.ts |
| 13 | SkillResolver (3.17#17) | skill-resolver.ts (+test), helpers.ts, specifications/index.ts |
| 14 | FlowLoader split (3.17#18) | +flowValidation.ts, FlowLoader.ts, FlowLoader.test.ts, FlowInstruction.test.ts, validate-flow.ts |

## Decisions log

- 2026-08-18: Subtask 9 (Schema + shared test script D, 3.17#27/#28) done — ForgeConfigSchema `logLevel`/`workspaceProvider`/`agents`/`defaultAgent` are now `Type.Optional` (defaults already supplied by `resolveConfig`/`DEFAULT_FORGE_CONFIG`); the derived `ForgeConfig` type re-declares the four as required (added to the `Omit` + intersection) since resolution always fills them — zero ripple into consumers (`ForgeConfig.getLogLevel()` keeps its plain `LogLevel` return). Field JSDoc now states defaults. Tests: 5 new schema acceptance cases (per-field omission + empty `{}` object) replace the two "rejects missing" cases; ConfigLoader test flipped from "throws InvalidConfigError when required fields are missing" to "loads a minimal config, filling defaults" (`{}` → INFO/git-worktree/empty Map/DEFAULT_AGENT_CONFIG). Bonus: the old "invalid YAML" test input `key: value\n  bad indent` is actually VALID YAML (plain scalar continuation — it only failed via missing-required-fields before); replaced with an unclosed flow sequence `key: [1, 2` (verified to throw in the yaml package). AC #28: new `packages/shared/vitest.config.ts` (root anchored at config file, setupFiles/globals/include mirroring the root config's shared project) — `npm run test` in packages/shared now runs only its 15 files/355 tests (~1.3s) instead of find-up'ing the root config and running the whole 121-file workspace; root `npm run test` still runs all projects (nearest-config-wins verified in vitest's `any(configFiles, { cwd: root })` walk-up). eslint: `vitest.config.ts` ignored in packages/shared/eslint.config.js (cli's `tsup.config.ts` precedent — root-level config files are outside the src-only tsconfig project). Verified: full suite 121 files/2353 tests green (+3 net tests), coverage unchanged 96.59% lines 96.98%. Commit: `refactor: schema defaults via Type.Optional, shared package-local vitest config (3.17#27/#28)`.

- 2026-08-18: Subtask 8 (Progress/e2e C) done — retention pruning extracted into `SharedStreamDir.pruneByRetention(baseDir)` (private, `retentionDays <= 0` early-return + singleton skip + mtime cutoff + rmSync warn), shared by `cleanup()` (which now only guards `existsSync` then delegates) and `sweepAndPrune()` (empty-dir pass, then one prune pass — both synchronous, so the two-pass split is behavior-identical to the old single loop); e2e helpers: `PROJECT_ROOT` now via `fileURLToPath(new URL("../", import.meta.url))` (was `.pathname` — breaks on Windows/percent-encoding), socket roundtrip timeout now `const timer` inside the promise executor with `clearTimeout(timer)` on data (was an unref'd dangling timer that fired `rej` after resolve). Verified: 121 files/2350 tests green, coverage unchanged at 96.59% (the single uncovered line 97 is the pre-existing rmdir-failure warn — no test triggers it in either version), full `forge-spec.e2e.test.ts` (25 tests) green. Note: `forge-subagent.e2e.test.ts` duplicates the same `.pathname` + dangling-timer pattern but is outside this subtask's file list (plan scoped to e2e/helpers.ts) — left as-is.

- 2026-08-18: Subtask 7 (TUI strings B) done — display em-dashes → hyphens (ProgressRenderer.formatAgentRow ` - `, AgentViewerOverlay role summaries, AgentDetailView title/header, tests updated incl. regex + `not.toContain` guards); separator width now = icon (via visibleWidth) + 1 + title + (subtitle ? 1 + subtitle : 0), matching the header; getOverlayOptions re-typed as pi-tui `OverlayOptions` with a validated `parseOverlayHeight` (percentage strings pass through, numeric pixel counts now actually clamp - previously pi-tui silently ignored bare number strings; invalid values fall back to the 85% default) - the lying `configHeight as "85%"` cast is gone and debug's test-loop-routine `overlayOptions` param upgraded from `Record<string, unknown>` to `OverlayOptions`; OrchestratorCommand docstring now numbers items 1-4; RoutineTool renderCall/renderResult context narrowed via local `ToolRowRenderContext` interface (eslint-disable + `any` index signature removed); TuiProgressReporter.ts/test renamed TuiRoutineWidget.ts/test (git mv, index export path); TOOL_PRESETS readOnly/reviewOnly share one `READ_ONLY_TOOLS` const (alias, `reviewOnly` still resolves for persona frontmatter `toolPreset: "reviewOnly"` in review.md) with a new constants.test.ts pinning identity. Commit: `refactor: TUI display strings, overlay height typing, widget rename (3.17#21/#22/#9/#8/#10/#19/#5)`.
- 2026-08-18: Subtask 7 review-feedback round — resolved iteration-2 findings F1-F4: (F1) the two remaining git-done logger.debug twins deleted (NOTES.md claim "3 dropped" now true; eventBus emits + logger.info/error kept); (F2) em-dashes in new comment lines replaced (Logger.ts docstring + getLogLevel JSDoc, FileLogger.initialize comment, ConfigLoader.test comment); (F3) invalid-JSON test now pins the singleton to the base console fallback (`Logger.resetForTest()` + `Logger.initialize()`) so it no longer depends on whichever logger earlier tests left active, and the base fallback paths gained direct coverage in logger.test.ts (all four severities print at DEBUG threshold, undefined-data omission, ERROR-threshold suppression, total getLogLevel()); (F4) base Logger docstring now states it prints to the console while it is the active instance. Commit: `refactor: drop remaining git-done debug twins, pin logger state in tests (review F1-F4)`.
- 2026-08-18: Subtask 6 (Dead code A) done — fillTemplate deleted (templates.ts + templates.test.ts + both export barrels), DynamicAgentSpecification.toJSON override deleted (inherits base), GitWorktreeProvider duplicated class JSDoc deduped (kept the one on the class), AgentViewerOverlay orphaned "Maximum characters" docstring deleted, AgentDetailView avgLinesPerMessage map + its per-render `.set` deleted (#154 heuristic comment still accurate for the kept conversation-line cache), GitStepExecutor 3 logger.debug twins dropped (git-start, git-done success/failure — eventBus emits + logger.info/error kept). Commit: `refactor: delete dead code — fillTemplate, toJSON override, twin git debug, docstrings (3.17#1/#4/#6/#7/#15/#20 + 3.10#5)`.
- 2026-08-18: Subtask 5 review findings (F1-F5) resolved — (F1) base Logger now prints to console while it is the active instance, so the ConfigLoader invalid-JSON warning is visible again during startup (was silently dropped between `Logger.initialize()` at import and `FileLogger.initialize()` at index.ts:111); (F2) ConfigLoader.test now spies on console.warn (observable output) instead of the base logger's warn; (F3) cycle actually broken now — ConfigLoader imports the `../logging/Logger` leaf (not the barrel) AND Logger no longer imports ForgeConfig: `getLogLevel()` = `instance?.level ?? INFO`, with FileLogger.initialize() applying the configured level once (behavior-identical in production; the earlier "permanently breaks the cycle" NOTES.md claim is now true rather than overstated); (F4) `getLogLevel()` is total — no more throw on `ForgeConfig.getInstance()` when config isn't loaded; (F5) the shouldLog guard lives once in `Logger.logToConsole`, shared by the base fallback and ConsoleLogger's four methods; console calls omit `undefined` data. Commit: `fix: restore pre-initialization console logging, total getLogLevel, cycle break (review F1-F5)`.
- 2026-08-18: Subtask 5 (Logger/console, 3.26 + 3.17#11 + 3.17#26) done — ConsoleLogger now guards every severity method with `shouldLog(level, Logger.getLogLevel())` mirroring FileLogger.writeEntry (tests spy on console methods, incl. SILENT and config-fallback via a ForgeConfig.getInstance stub); shared manifest fixed (yaml ^2.9.0 + typebox 1.3.8 → dependencies, vitest 4.1.9 → devDependencies, lockfile updated); console.warn/error → logger in ConfigLoader (invalid-JSON warning), spec-resolution (FORGE_SPEC deserialize error), tool-restrictions (pattern-match failure) with test spies moved from console to the module-level `logger`; DEFAULT_LOG_LEVEL deleted (LogLevel.ts + test block + logging/index + shared/index exports). The ConfigLoader → ../logging import exposed a config↔logging circular import (config/index exports ConfigLoader before ForgeConfigSchema, so `LogLevel.SILENT` was read before the enum binding initialized — crashed all 121 test files). Fix: logging modules import from leaf modules (`../config/ForgeConfig`, `../config/ForgeConfigSchema`) instead of the `../config` barrel — matches the established leaf-import convention (ConfigLoader, ForgeConfigDefaults) and permanently breaks the cycle. Commit: `refactor: ConsoleLogger level filtering, logger-based warnings, DEFAULT_LOG_LEVEL removal (3.26+3.17#11+#26)`.
- 2026-08-18: Workspace node_modules incident — a plain `npm install` in the worktree hit ENOTDIR mid-reify and destroyed the symlink-farm node_modules (all 30 scoped @dirs emptied; reify also wrote through the `@earendil-works` symlink into the main checkout's node_modules, deleting pi-*/@vitest/@types/... real-name dirs). Repaired: main's `@earendil-works` and 100+ scoped dirs restored by renaming the content-bearing `.pkg-XXXX` temp dirs to real names (versions verified against package-lock.json); worktree's scoped dirs re-created as symlinks into main's node_modules (the ws-3f25704b pattern). Lesson: do NOT run npm install in forge worktrees — use `npm install --package-lock-only` for lockfile-only changes.

- 2026-08-18: Subtask 4 verify follow-up — verify of `293fb16c` failed on AC 3.28/P2-11 #2: the socket `error` handler only rejected the connect promise during the connect phase; after connection, an error rejected nothing, so pending requests leaked into the timeout (error-first ordering). Fix: `socket.on("error")` now calls `rejectAllPending(new IpcConnectionError(...))` when connected (close handler still owns state reset). Regression test uses the mock-`node:net` pattern and emits only `error` (no `close`) so the error path alone must satisfy the assertion — a raw-server test couldn't pin it because abrupt teardown always emits both. Assertion is by name/message because `vi.resetModules` + dynamic import breaks `instanceof` against the top-level class. Commit: `refactor: reject pending IPC requests on post-connection socket error (3.28)`.
- 2026-08-18: ChildSocketClient (3.13) done — `request()` throws IpcConnectionError immediately when disconnected (was: silent no-op write + full timeout wait); pending entry registered before the write; socket `close` rejects all pending (no caller waits out a timeout after transport death); `connect()` stores an in-flight `connectPromise` so concurrent/repeated calls share one connection (reset on close/failure to allow reconnect). Tests: immediate-reject replaces the old "times out instead of writing" test; new close-rejects-pending (raw server, 2s timeout to fail fast on regression); double-connect guard (concurrent + repeated, connection count 1); register-before-write proven with a mock `node:net` whose `write()` delivers the response synchronously. Commit: `refactor: harden ChildSocketClient request lifecycle (3.13)`.
- 2026-08-18: Workspace fixes (3.11+3.12) done — WorkspaceStepExecutor keys workspace + result by `instruction.id`; WorkspaceManager `destroy`/`get` renamed to `path` (error message now "No workspace found at path"), doc note added (registry keys by path). New regression test "stores each workspace under its own instruction id" (two workspace instructions in one routine no longer overwrite; `mockImplementationOnce` sequence used since the file-level mock returns a constant UUID). Commit: `refactor: fix workspace id keying and WorkspaceManager path naming (3.11+3.12)`.
- 2026-08-18: FlowStateStore (3.8) done — standalone Map-backed class with exactly get/set/entries/toObject; registry-query tests (has/size/unregister/getAll/where) dropped with the methods. Production callers only used the four kept methods. Commit: `refactor: make FlowStateStore a standalone Map-backed class (3.8)`.
- 2026-08-18: Phase 0 scope = roadmap Phase 0 headline + gantt items p0a-p0d; all subtasks independent, no file overlaps between them (AgentDetailView/AgentViewerOverlay changes consolidated in subtask 7).
- 2026-08-18: IpcTool goes in `shared` with a structural `IpcRequestClient` interface (method-signature bivariance keeps `ChildSocketClient` assignable); it moves alongside wire types in Phase 1 if needed.
- 2026-08-18: IpcTool implements `execute` itself (params `unknown`); only SendTaskTool overrides it to thread `params.timeout` through. A generic `execute<P>` was tried first — TS rejects generic-method overrides with narrower param types, so `unknown` + one override is the shape (why: override compatibility). Per-tool tests kept as-is; error-shape coverage now also centralized in IpcTool.test.ts. Subtask 1 commit: `refactor: extract IpcTool base class for agent IPC tools (3.4)`.
- 2026-08-18: Review P2 follow-ups from subtask 1 queued for a final cleanup subtask: freeze `NO_CLIENT_ERROR` (as const/Readonly), em-dash → hyphen in IpcTool.ts JSDoc, ADR for the IpcTool/IpcRequestClient abstraction (AGENTS.md requires ADR for new public APIs). Abort-swallow and bivariance findings accepted as behavior-preserving (documented, pre-existing).
