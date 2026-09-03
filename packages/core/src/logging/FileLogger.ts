import { type Dirent, existsSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

import { DEFAULT_FORGE_CONFIG } from "../config/ForgeConfigDefaults";
import type { ForgeConfig } from "../config/ForgeConfigSchema";
import { LogLevel } from "../config/ForgeConfigSchema";
import { Logger, logger } from "./Logger";
import { RotatingFileSink } from "./RotatingFileSink";

/** Shape of a single log entry written to the JSON Lines file. */
interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Optional overrides for the underlying {@link RotatingFileSink}.
 *
 * Tests pass small `maxBytes`/`maxFiles` values to exercise rotation and
 * count retention without writing megabytes. When omitted, the values come
 * from the injected config (`logMaxBytes`/`logMaxFiles`).
 */
export interface FileLoggerSinkOverrides {
  /** Rotate to a new segment once the active file exceeds this many bytes. */
  maxBytes?: number;
  /** Maximum number of files kept by count retention. */
  maxFiles?: number;
}

/** Newest stale log segments retained per dead process/day (OMP parity). */
const RETAINED_STALE_LOGS_PER_PROCESS_DAY = 3;
/** Calendar days of stale logs retained for dead processes (today included). */
const RETAINED_STALE_LOG_DAYS = 5;

/**
 * Logger that appends JSON Lines entries to a rotating file sink.
 *
 * Only entries at or above the configured {@link level} are written.
 * Each entry is a single JSON object on its own line:
 * `{"timestamp":"...","level":"error","message":"...","data":{...}}`
 *
 * Production logs use OMP-compatible naming `forge.<day>.<pid>.log[.N]`
 * with a persistent audit ledger for cross-restart count retention. When an
 * explicit `filePath` is passed (tests, custom paths) the sink writes to
 * that exact base filename without day rotation or audit ledger.
 */
export class FileLogger extends Logger {
  private readonly filePath: string;
  private readonly sink: RotatingFileSink;

  /**
   * @param config — Fully resolved configuration providing the log dir,
   *   prefix, retention, rotation and level settings.
   * @param filePath — Absolute path to the log file (created on first write).
   *   When omitted, the OMP-style production sink is used.
   * @param sinkOverrides — Rotation/retention overrides for the sink.
   */
  private constructor(
    config: Readonly<ForgeConfig>,
    filePath?: string,
    sinkOverrides?: FileLoggerSinkOverrides,
  ) {
    super();

    this.filePath = filePath ?? FileLogger.getDefaultLogFilePath(config);

    const maxBytes =
      sinkOverrides?.maxBytes ?? config.logMaxBytes ?? DEFAULT_FORGE_CONFIG.logMaxBytes;
    const maxFiles =
      sinkOverrides?.maxFiles ?? config.logMaxFiles ?? DEFAULT_FORGE_CONFIG.logMaxFiles;

    this.sink =
      filePath === undefined
        ? FileLogger.createProductionSink(config, maxBytes, maxFiles)
        : FileLogger.createExplicitSink(filePath, maxBytes, maxFiles);
  }

  /**
   * Initialize the logger singleton with a new FileLogger instance.
   *
   * @param config — Fully resolved configuration (log dir, prefix, level,
   *   retention and rotation settings). Required: FileLogger receives its
   *   config explicitly and holds no global config access.
   * @param filePath — Absolute path to the log file (created on first
   *   write). When omitted, the OMP-style production sink is used.
   * @param sinkOverrides — Rotation/retention overrides for the sink.
   */
  static initialize(
    config: Readonly<ForgeConfig>,
    filePath?: string,
    sinkOverrides?: FileLoggerSinkOverrides,
  ): FileLogger;
  /**
   * Config-less initialization is no longer supported (the logger never
   * consults a global config - it only reads what is passed explicitly).
   * Declared so the static contract of the base {@link Logger.initialize}
   * stays satisfiable; calling it fails fast below.
   */
  static initialize(): never;
  static initialize(
    config?: Readonly<ForgeConfig>,
    filePath?: string,
    sinkOverrides?: FileLoggerSinkOverrides,
  ): FileLogger {
    if (config === undefined) {
      throw new Error("FileLogger.initialize requires an explicit config argument");
    }
    // Remove completed-process namespaces before opening a new sink (OMP
    // parity): dead-pid segments and audits would otherwise accumulate
    // forever, bounded only by the age-based prune below.
    FileLogger.pruneStaleProcessLogs(config, config.logDir ?? DEFAULT_FORGE_CONFIG.logDir);
    const logger = new FileLogger(config, filePath, sinkOverrides);
    Logger.instance = logger;
    // Apply the configured level once at initialization - subsequent
    // filtering reads the instance level (see Logger.getLogLevel), so
    // the logger never consults the config on a per-call basis.
    Logger.setLogLevel(config.logLevel ?? DEFAULT_FORGE_CONFIG.logLevel);
    FileLogger.pruneOldLogs(
      config,
      config.logRetentionDays ?? DEFAULT_FORGE_CONFIG.logRetentionDays,
      logger.filePath,
    );
    return logger;
  }

  /**
   * Delete log files in the configured log directory whose modification
   * time is older than `retentionDays` days.
   *
   * Only files directly inside the log directory are considered —
   * subdirectories (e.g. `agent-streams-*`) and the audit ledger are left
   * untouched. Both the base `.log` files and rotated segments
   * (`.log.1`, `.log.2`, ...) are matched. A `retentionDays` of 0 or less
   * disables pruning entirely.
   *
   * @param config — Fully resolved configuration providing the log dir to
   *   scan and the prefix of this process's own segments.
   * @param retentionDays — Retention window in days (0 = never prune).
   * @param currentFilePath — Path of the active session's log file, which
   *   is never pruned. The whole segment set of the current process is
   *   protected too (the active segment is dynamic under rotation).
   */
  static pruneOldLogs(
    config: Readonly<ForgeConfig>,
    retentionDays: number,
    currentFilePath?: string,
  ): void {
    if (retentionDays <= 0) {
      return;
    }

    const logDir = config.logDir ?? DEFAULT_FORGE_CONFIG.logDir;
    if (!existsSync(logDir)) {
      return;
    }

    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let considered = 0;
    let deleted = 0;

    try {
      for (const entry of readdirSync(logDir, { withFileTypes: true })) {
        // Skip subdirectories, the audit ledger, and any non-log file.
        if (!entry.isFile() || !FileLogger.isLogSegmentName(entry.name)) {
          continue;
        }

        const fullPath = path.resolve(logDir, entry.name);
        // Never prune the active session's own log file.
        if (currentFilePath !== undefined && path.resolve(currentFilePath) === fullPath) {
          continue;
        }
        // With the rotating sink the "active" file is a dynamic segment set
        // of the current process; age-pruning must not delete any of them.
        if (FileLogger.isCurrentProcessSegment(config, entry.name)) {
          continue;
        }

        try {
          if (statSync(fullPath).mtimeMs < cutoff) {
            unlinkSync(fullPath);
            deleted += 1;
          }
          considered += 1;
        } catch (error) {
          logger.warn(`Log retention: failed to inspect or delete ${fullPath}: ${String(error)}`);
        }
      }
    } catch (error) {
      logger.warn(`Log retention: cannot read log directory ${logDir}: ${String(error)}`);
      return;
    }

    // Report the retention outcome on every run (even when nothing was
    // pruned); like any other entry it is filtered by the session log level.
    logger.info(
      `Log retention: pruned ${deleted} of ${considered} files older than ${retentionDays} days`,
    );
  }

  /**
   * Remove log namespaces of completed processes from `logDir` (OMP
   * parity).
   *
   * Live PID namespaces are never touched. For dead processes: audit
   * ledgers (`.forge-<pid>-audit.json`) are deleted outright; rotated logs
   * (`forge.<day>.<pid>.log[.N]`) are kept only within the current and
   * previous {@link RETAINED_STALE_LOG_DAYS} calendar days, at most
   * {@link RETAINED_STALE_LOGS_PER_PROCESS_DAY} newest segments per
   * process/day.
   *
   * @param config — Fully resolved configuration providing the log prefix
   *   whose namespaces are matched.
   * @param logDir — Directory to scan (must exist; a missing or unreadable
   *   directory is a no-op).
   */
  static pruneStaleProcessLogs(config: Readonly<ForgeConfig>, logDir: string): void {
    let entries: Dirent[];
    try {
      entries = readdirSync(logDir, { withFileTypes: true });
    } catch {
      return;
    }

    const current = new Date();
    const currentDate = RotatingFileSink.dayKey(current);
    const cutoff = new Date(current);
    cutoff.setDate(cutoff.getDate() - (RETAINED_STALE_LOG_DAYS - 1));
    const cutoffDate = RotatingFileSink.dayKey(cutoff);

    const escapedPrefix = FileLogger.escapeRegex(FileLogger.resolveLogPrefix(config));
    const processLogPattern = new RegExp(
      `^${escapedPrefix}\\.(\\d{4}-\\d{2}-\\d{2})\\.(\\d+)\\.log(?:\\.(\\d+))?$`,
    );
    const processAuditPattern = new RegExp(`^\\.${escapedPrefix}-(\\d+)-audit\\.json$`);

    const staleLogsByProcessDay = new Map<string, Array<{ path: string; rollover: number }>>();
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const logMatch = processLogPattern.exec(entry.name);
      const auditMatch = processAuditPattern.exec(entry.name);
      const pidText = logMatch?.[2] ?? auditMatch?.[1];
      // Live PID namespaces are never touched.
      if (!pidText || FileLogger.processIsRunning(Number(pidText))) continue;
      const entryPath = path.join(logDir, entry.name);

      // Audits are one-use ledgers: dead processes' ledgers are removed
      // outright - the segments they account for are handled below.
      if (auditMatch) {
        try {
          rmSync(entryPath, { force: true });
        } catch {
          // Retention is best-effort; logging must still initialize.
        }
        continue;
      }
      if (!logMatch?.[1]) continue;
      // Only the current and previous RETAINED_STALE_LOG_DAYS-1 calendar
      // days are kept for completed processes; anything else is deleted.
      if (logMatch[1] < cutoffDate || logMatch[1] > currentDate) {
        try {
          rmSync(entryPath, { force: true });
        } catch {
          // Another process may have pruned the same stale namespace.
        }
        continue;
      }

      const key = `${pidText}:${logMatch[1]}`;
      const staleLogs = staleLogsByProcessDay.get(key) ?? [];
      staleLogs.push({ path: entryPath, rollover: Number(logMatch[3] ?? 0) });
      staleLogsByProcessDay.set(key, staleLogs);
    }

    for (const staleLogs of staleLogsByProcessDay.values()) {
      if (staleLogs.length <= RETAINED_STALE_LOGS_PER_PROCESS_DAY) continue;
      const ranked: Array<{ path: string; mtimeMs: number; rollover: number }> = [];
      for (const stale of staleLogs) {
        try {
          ranked.push({ ...stale, mtimeMs: statSync(stale.path).mtimeMs });
        } catch {
          // Another process may have pruned the same stale namespace.
        }
      }
      ranked.sort(
        (a, b) =>
          b.mtimeMs - a.mtimeMs ||
          b.rollover - a.rollover ||
          (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
      );
      for (const stale of ranked.slice(RETAINED_STALE_LOGS_PER_PROCESS_DAY)) {
        try {
          rmSync(stale.path, { force: true });
        } catch {
          // Best-effort retention; a failed removal must not surface.
        }
      }
    }
  }

  /**
   * Resolve the base (index-0) path of the production log file for the
   * current day: `join(logDir, "forge.<day>.<pid>.log")`.
   */
  static getDefaultLogFilePath(config: Readonly<ForgeConfig>): string {
    return path.join(
      config.logDir ?? DEFAULT_FORGE_CONFIG.logDir,
      `${FileLogger.resolveLogPrefix(config)}.${RotatingFileSink.dayKey(new Date())}.${process.pid}.log`,
    );
  }

  /**
   * Resolve a human-readable prefix for log filenames from configuration.
   *
   * Defaults to `"forge"` for the orchestrator. Child agents receive
   * their agent id via the config initialisation path.
   */
  private static resolveLogPrefix(config: Readonly<ForgeConfig>): string {
    return config.logPrefix ?? DEFAULT_FORGE_CONFIG.logPrefix;
  }

  /** Production sink: full OMP naming + day rotation + audit ledger. */
  private static createProductionSink(
    config: Readonly<ForgeConfig>,
    maxBytes: number,
    maxFiles: number,
  ): RotatingFileSink {
    const logDir = config.logDir ?? DEFAULT_FORGE_CONFIG.logDir;
    const prefix = FileLogger.resolveLogPrefix(config);
    return new RotatingFileSink({
      directory: logDir,
      filenamePrefix: prefix,
      filenameSuffix: String(process.pid),
      extension: "log",
      dayRotation: true,
      // The ledger name derives from the configured prefix so that
      // pruneStaleProcessLogs (which matches `.<prefix>-<pid>-audit.json`)
      // can remove a process's own ledger on the next startup regardless of
      // which prefix that process logged under.
      auditFile: path.join(logDir, `.${prefix}-${process.pid}-audit.json`),
      maxBytes,
      maxFiles,
    });
  }

  /**
   * Explicit-path sink (tests, custom paths): writes to exactly `filePath`
   * as the index-0 segment, no day rotation, no audit ledger. The
   * extension is derived from the path (e.g. `.log`); a path without an
   * extension keeps its bare basename.
   */
  private static createExplicitSink(
    filePath: string,
    maxBytes: number,
    maxFiles: number,
  ): RotatingFileSink {
    const extension = path.extname(filePath).slice(1);
    return new RotatingFileSink({
      directory: path.dirname(filePath),
      filenamePrefix: path.basename(filePath, extension ? `.${extension}` : ""),
      filenameSuffix: "",
      extension,
      dayRotation: false,
      maxBytes,
      maxFiles,
    });
  }

  /** `.log` base files and rotated `.log.N` segments. */
  private static isLogSegmentName(name: string): boolean {
    return name.endsWith(".log") || /\.log\.\d+$/.test(name);
  }

  /** True for any rotated segment of THIS process under the current prefix. */
  private static isCurrentProcessSegment(config: Readonly<ForgeConfig>, name: string): boolean {
    const escapedPrefix = FileLogger.escapeRegex(FileLogger.resolveLogPrefix(config));
    return new RegExp(
      `^${escapedPrefix}\\.\\d{4}-\\d{2}-\\d{2}\\.${process.pid}\\.log(?:\\.\\d+)?$`,
    ).test(name);
  }

  private static processIsRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (error instanceof Error && "code" in error) {
        const code = (error as NodeJS.ErrnoException).code;
        // Only a definitely-dead pid (ESRCH) or an invalid signal (EINVAL)
        // means the process is not running. Anything else (e.g. EPERM for a
        // process owned by another user) is treated as alive - retention
        // must never delete a namespace that might still be in use.
        return code !== "ESRCH" && code !== "EINVAL";
      }
      // Unknown error shape: conservatively assume the process is alive.
      return true;
    }
  }

  private static escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  override error(message: string, data?: Record<string, unknown>): void {
    this.writeEntry(LogLevel.ERROR, message, data);
  }

  override warn(message: string, data?: Record<string, unknown>): void {
    this.writeEntry(LogLevel.WARN, message, data);
  }

  override info(message: string, data?: Record<string, unknown>): void {
    this.writeEntry(LogLevel.INFO, message, data);
  }

  override debug(message: string, data?: Record<string, unknown>): void {
    this.writeEntry(LogLevel.DEBUG, message, data);
  }

  /**
   * Stop accepting entries. Writes after close are best-effort no-ops
   * (the sink reports `false` and the entry is dropped silently).
   */
  async close(): Promise<void> {
    this.sink.close();
  }

  private writeEntry(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level, Logger.getLogLevel())) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: level.toLowerCase(),
      message,
    };
    if (data !== undefined) {
      entry.data = data;
    }

    try {
      // The sink appends the platform line ending itself.
      this.sink.write(JSON.stringify(entry));
    } catch {
      // Best-effort: if entry can't be serialized (e.g., circular references),
      // silently drop it rather than crashing the process.
    }
  }
}
