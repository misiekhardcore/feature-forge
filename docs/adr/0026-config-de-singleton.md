# ADR 0026: Config de-singleton (explicit plain-object config)

**Date:** 2026-09-03
**Status:** Accepted (implemented by Phase 3a of the architecture review)

## Context

The architecture review (`docs/architecture-review.md`, finding P0-3) called
out `ForgeConfig` as a pervasive service-locator singleton reaching into
~15 production files, from agent transport to TUI state. The class held
**static state** (`_instance`, `_config`, `signalHandler`, `cwd`), installed
a **process-level side effect** (`process.on("SIGHUP", ...)` inside a config
class), and exposed **20+ typed accessor methods** that re-applied defaults
one by one. Consumers reached it from anywhere - `PiSubprocessAgent`,
`ChildSocketClient`, `AgentStepExecutor`, `RoutineTool`, `FileLogger`,
spec resolution, and the TUI viewer - so config was a hidden dependency of
every layer, and tests paid a three-way tax: three `test-setup.ts` copies
existed solely to `await ForgeConfig.create()` before import-time
`getInstance()` calls in deep modules could run, and suites needed
`ForgeConfig.destroy()` between cases to reset the static state.

The composition root (`packages/cli/src/index.ts`) already constructs every
service by hand, so the singleton was redundant there; wiring had simply
been skipped in the deep layers. The fix is mechanical per consumer: each
already has a constructor - add one explicit config parameter (or an
options-object field for it).

## Decision

- **D1 - Config is a plain, deep-frozen resolved object.** The resolved
  config (`ForgeConfigData`, the schema-inferred `ForgeConfig` type from
  `ForgeConfigSchema`) is a value, not a service. `ConfigLoader` /
  `ForgeConfigLoader.load` return a freshly resolved, deep-frozen object on
  every call; nothing caches it process-wide.
- **D2 - The composition root loads config once and injects it.**
  `packages/cli/src/index.ts` loads via `ForgeConfigLoader` at startup and
  passes the config (or the specific values consumers need) through
  constructors and options objects. Consumers never import a config holder.
  The `ForgeConfig` singleton class is deleted; `ForgeConfigData` remains
  the exported name for the data type.
- **D3 - Path derivation is a static helper.** `ForgeConfigPaths`
  (`resolveForgeDir`, `resolveFlowDirectories`,
  `resolveAgentSpecDirectories`) derives absolute paths from an explicit
  config object plus the project cwd - tilde prefixes expand against
  `os.homedir()`, all other relative paths resolve against the passed cwd -
  with no process-global reads.
- **D4 - SIGHUP live reload is removed, deliberately.** The singleton's
  `process.on("SIGHUP", () => ForgeConfig.reload())` behavior is gone.
  Config is a startup snapshot: it is captured per construction site, and
  changing config requires an extension restart. The options types that
  capture config at construction (`PiSubprocessAgentOptions`,
  `PiSubprocessAgentFactoryOptions`, `AgentViewerConfig`, the CLI TUI
  wiring) document that capture semantics. This trades mid-session config
  hot-reload for an immutable, stateless, testable config surface.
- **D5 - Default-fallback semantics live with the defaults.**
  `DEFAULT_FORGE_CONFIG` / `DEFAULT_AGENT_CONFIG` (`ForgeConfigDefaults`)
  and the schema Decode path remain the single source of per-field
  defaults; the class's one-by-one accessor fallbacks are not re-created.
  Viewer-config resolution (display block, hide-thinking-block settings
  merge, overlay-height coercion) lives in `AgentViewerConfig`, which reads
  pi's `settings.json` files fresh per call - the Ctrl+T toggle semantics
  are preserved there.

## Consequences

- **Hot config reload via SIGHUP no longer propagates mid-session.** A
  running extension keeps the config snapshot captured at startup; applying
  config changes requires restarting the extension. This is a deliberate
  behavior change (D4) and the trade-off that buys statelessness.
- **Per-construction capture is now explicit.** Each options type documents
  that the config (or derived value) it received is fixed for the lifetime
  of the constructed object.
- **The test tax disappears.** Both `test-setup.ts` bootstraps
  (`packages/core/src/test-setup.ts`, `packages/cli/src/test-setup.ts`) are
  deleted, and the vitest projects no longer reference setup files: nothing
  calls `ForgeConfig.getInstance()` at import time anymore, so the suite
  runs with `setup 0ms`. Tests inject config explicitly or exercise
  defaults directly.
- **The config object is immutable.** Loaders deep-freeze the resolved
  object (nested structures and Map mutators throw), so handing a config to
  a consumer can never corrupt the shared default or another consumer's
  snapshot.
- **Path resolution is a pure function of (config, cwd).** The same config
  can be resolved against different roots, and tests no longer need to
  bootstrap a singleton to derive paths.
- **Deleted surface:** the `ForgeConfig` class, its spec, and the
  `ForgeConfigData` alias in `config/index.ts` is kept as the consumer
  type. No new config holder/registry singleton is introduced.
