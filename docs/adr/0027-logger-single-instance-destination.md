# ADR 0027: Logger single-instance destination (removing the two-stage swap)

**Date:** 2026-09-03
**Status:** Accepted (implemented by Phase 3b of the architecture review)

## Context

The architecture review (`docs/architecture-review.md`, section 5 "Key
properties of the target", property 3) names the logger as the only
module-level state left after the config de-singleton (ADR 0026): _"the only
module-level state left is the logger (which should be an explicit dependency
too, or at least a single, non-forwarding instance)."_ Roadmap item p3b
("Logger simplification", after p3a) scopes the work to the second, weaker
option: replace the two-stage forwarding singleton with a single
non-forwarding instance.

The old logger was a service locator with a hidden swap slot, all inside
`packages/core/src/logging/Logger.ts`:

- A **static mutable singleton**: `protected static instance`, plus statics
  `getInstance()` (throws "Logger not initialized" when uninitialized),
  `initialize()`, `resetForTest()`, `setLogLevel()` and `getLogLevel()`.
  Module scope created stage one: `export const logger = Logger.initialize()`,
  a base console logger.
- A **two-stage forwarding design**: `FileLogger.initialize(config)` (and
  `ConsoleLogger.initialize()`) built a concrete logger and **replaced** the
  static slot (`Logger.instance = logger`); every severity method on the base
  instance forwarded to whichever instance was registered
  (`if (Logger.instance && Logger.instance !== this)`), else printed to the
  console. The module `logger` const never changed identity - calls silently
  forwarded to the swapped-in instance.
- **Cross-test reset tax**: tests that shared the module logger had to
  `Logger.resetForTest()` / re-`initialize()` between files
  (`packages/cli/src/index.test.ts`,
  `packages/core/src/config/ConfigLoader.test.ts`).
- **Dead code**: `ConsoleLogger` was exported but never initialized in
  production (`FileLogger.initialize` was the only production entry), which
  is review hygiene list item 3.17 #3 ("exported, never initialized in
  production. Delete or wire into a --console-logs mode"). Its level
  filtering lived in `logToConsole` on the base class; that `ConsoleLogger`
  never consulted the configured level is a separate finding (review row
  3.26 P2-9, which also covers the `shared/package.json` manifest issues)
  and is not part of the dead-export finding.

The two-stage swap existed because `FileLogger` **extended** `Logger` and had
to become "the logger" for the whole process. Once file output is modeled as
a _destination_ attached to a logger instance instead of as a _kind of
logger_, the swap slot has no reason to exist.

## Decision

- **D1 - `Logger` is a concrete instance owning its level and destination.**
  Instance state is `level: LogLevel` (default `LogLevel.INFO`, the config
  schema default) and `destination: LoggerDestination | undefined`
  (`undefined` = console fallback). Each severity method filters with
  `shouldLog(level, this.level)` and then writes to `this.destination` or to
  the console. No statics, no static instance slot, no forwarding to another
  logger, no `getInstance()` throw path.
- **D2 - The module export is the single instance.**
  `export const logger = new Logger()` in `packages/core/src/logging/Logger.ts`
  starts console-only. The composition root (`packages/cli/src/index.ts`)
  calls `FileLogger.install(config)` once at startup; entries emitted before
  that (config warnings) reach the console, entries after it reach the file -
  identical observable behavior to the old two-stage flow.
- **D3 - `LoggerDestination` is the sink contract.**
  `write(level, message, data?)` plus `close(): void | Promise<void>`;
  destinations do not filter - the owning `Logger` filters before
  delegating.
- **D4 - `FileLogger` becomes a destination, not a logger.** It no longer
  extends `Logger`; it `implements LoggerDestination` and formats JSON Lines
  over the unchanged `RotatingFileSink` (ADR 0024).
  `FileLogger.create(config, filePath?, sinkOverrides?)` is a pure
  constructor (no pruning, no logger mutation; the file is created on first
  write). `FileLogger.install(config, filePath?, sinkOverrides?)` is the
  composition-root wiring entry and mirrors the old `FileLogger.initialize`
  side-effect ordering against the module logger instance instead of a static
  slot: prune stale-process logs, build the destination,
  `moduleLogger.configure({ level, destination })` with `config.logLevel`,
  then prune old logs. Retention/prune/path statics (`pruneOldLogs`,
  `pruneStaleProcessLogs`, `getDefaultLogFilePath`) keep their exact
  signatures and behavior.
- **D5 - `ConsoleLogger` is deleted.** Console output is the base `Logger`
  behavior when no destination is attached, so the subclass added nothing;
  its level-filtering coverage (default INFO, SILENT suppression) was folded
  into `packages/core/src/logging/logger.test.ts`, and the logging barrel
  (`packages/core/src/logging/index.ts`) drops the export.
- **D6 - Level is applied once, at install time.** `FileLogger.install`
  applies `config.logLevel` to the module logger instance and the config is
  never re-read on a per-call basis - the same startup-snapshot semantics as
  the config de-singleton (ADR 0026 D4). The instance API `setLevel` /
  `getLevel` covers level-only changes; `configure({ level?, destination? })`
  is a partial update - `level` applies only when provided, and an omitted
  `destination` key leaves the current destination attached. An explicit
  `destination: null`/`undefined` detaches back to the console fallback.

## Consequences

- **Single non-forwarding instance.** Logging state is one instance owning a
  level and a destination; there is no service locator, no hidden swap slot,
  no static mutable `instance`, and no `getInstance()` that throws when
  uninitialized.
- **The test tax disappears.** `Logger.resetForTest()` is gone; downstream
  tests reset the module logger explicitly with
  `logger.configure({ level: LogLevel.INFO, destination: null })`
  (`packages/cli/src/index.test.ts`,
  `packages/core/src/config/ConfigLoader.test.ts`). Unit tests construct
  their own `new Logger()` plus a fake destination, so no shared state needs
  resetting between cases.
- **Composition replaces inheritance.** A `FileLogger` is a standalone
  destination (`create`) or a wiring step for the module logger (`install`);
  level filtering lives in exactly one place (the owning `Logger`), which
  also fixes the old contract violation that `ConsoleLogger` never consulted
  the configured level (review row 3.26).
- **Observable file behavior is unchanged.** JSON Lines shape, OMP-compatible
  naming (`forge.<day>.<pid>.log[.N]`), audit ledger, rotation, retention and
  stale-process pruning all live in unchanged code paths (`RotatingFileSink`,
  the retained `FileLogger` statics).
- **`FileLogger.install` still mutates the process-global module logger.** A
  second `install()` call replaces the destination without closing the prior
  sink - the same behavior as the old two-stage swap, which replaced
  `Logger.instance` without closing what it displaced. This is accepted under
  the review's "at least a single, non-forwarding instance" bar; full
  constructor injection of a `Logger` into every consumer is a possible
  future step and is explicitly out of scope for 3b.
- **Close and detach are orthogonal.** `Logger.close()` closes the attached
  destination but leaves it attached, so writes after close are best-effort
  no-ops on the closed sink. `configure({ destination: null })` detaches to
  the console fallback without closing the displaced sink. Both are
  intentional - closing is the shutdown path, detaching is a routing change -
  and mirror the prior `FileLogger` close semantics (the old swap never
  closed what it displaced either).
- **Removed references:** `ConsoleLogger` is deleted, which resolves the
  `ConsoleLogger` findings in `docs/architecture-review.md` rows 3.26 (P2-9)
  and hygiene item 3.17 #3. The review document itself is a historical record
  and is not edited; this ADR supersedes those rows.
