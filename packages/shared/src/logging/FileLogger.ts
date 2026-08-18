import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  type WriteStream,
} from "node:fs";
import path from "node:path";

import { ForgeConfig } from "../config/ForgeConfig";
import { LogLevel } from "../config/ForgeConfigSchema";
import { Logger, logger } from "./Logger";

/** Shape of a single log entry written to the JSON Lines file. */
interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Logger that appends JSON Lines entries to a file.
 *
 * Only entries at or above the configured {@link level} are written.
 * Each entry is a single JSON object on its own line:
 * `{"timestamp":"...","level":"error","message":"...","data":{...}}`
 *
 * The write stream is opened lazily on first write and remains open for
 * the session lifetime.
 */
export class FileLogger extends Logger {
  private readonly filePath: string;
  private _stream: WriteStream | null = null;

  /**
   * @param filePath — Absolute path to the log file (created on first write).
   */
  private constructor(filePath?: string) {
    super();

    this.filePath = filePath ?? FileLogger.getDefaultLogFilePath();
    if (!existsSync(this.filePath)) {
      const dir = path.dirname(this.filePath);
      mkdirSync(dir, { recursive: true });
    }
  }

  static initialize(filePath?: string): FileLogger {
    const logger = new FileLogger(filePath);
    Logger.instance = logger;
    FileLogger.pruneOldLogs(ForgeConfig.getInstance().getLogRetentionDays(), logger.filePath);
    return logger;
  }

  /**
   * Delete log files in the configured log directory whose modification
   * time is older than `retentionDays` days.
   *
   * Only files directly inside the log directory are considered —
   * subdirectories (e.g. `agent-streams-*`) are left untouched. A
   * `retentionDays` of 0 or less disables pruning entirely.
   *
   * @param retentionDays — Retention window in days (0 = never prune).
   * @param currentFilePath — Path of the active session's log file, which
   *   is never pruned.
   */
  static pruneOldLogs(retentionDays: number, currentFilePath?: string): void {
    if (retentionDays <= 0) {
      return;
    }

    const logDir = ForgeConfig.getInstance().getLogDir();
    if (!existsSync(logDir)) {
      return;
    }

    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let considered = 0;
    let deleted = 0;

    for (const entry of readdirSync(logDir, { withFileTypes: true })) {
      // Skip subdirectories and non-log files.
      if (!entry.isFile() || !entry.name.endsWith(".log")) {
        continue;
      }

      const fullPath = path.resolve(logDir, entry.name);
      // Never prune the active session's own log file.
      if (currentFilePath !== undefined && path.resolve(currentFilePath) === fullPath) {
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

    if (deleted > 0) {
      logger.info(
        `Log retention: pruned ${deleted} of ${considered} files older than ${retentionDays} days`,
      );
    }
  }

  static getDefaultLogFilePath(): string {
    const prefix = FileLogger.resolveLogPrefix();
    const now = new Date();
    const iso = now.toISOString().replace(/-/g, "").replace(/:/g, "").slice(0, 13);
    return path.join(ForgeConfig.getInstance().getLogDir(), `${prefix}-${iso}.log`);
  }

  /**
   * Resolve a human-readable prefix for log filenames from configuration.
   *
   * Delegates to {@link ForgeConfig.getLogPrefix}, which defaults to
   * `"forge"` for the orchestrator. Child agents receive their agent id
   * via the config initialisation path.
   */
  private static resolveLogPrefix(): string {
    return ForgeConfig.getInstance().getLogPrefix();
  }

  /** Lazily-initialised write stream — no file created until first write. */
  private get stream(): WriteStream {
    if (!this._stream) {
      this._stream = createWriteStream(this.filePath, { flags: "a" });
    }
    return this._stream;
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
   * Close the underlying write stream.
   *
   * Call during shutdown to flush any buffered writes. Resolves when the
   * stream has finished closing. After calling close, further log calls
   * will silently fail (best-effort, no error propagation).
   */
  async close(): Promise<void> {
    if (!this._stream || this._stream.destroyed) {
      return;
    }
    const stream = this._stream;
    return new Promise<void>((resolve) => {
      stream.end(() => resolve());
    });
  }

  private writeEntry(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (this._stream?.destroyed) {
      return;
    }

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
      this.stream.write(JSON.stringify(entry) + "\n");
    } catch {
      // Best-effort: if entry can't be serialized (e.g., circular references),
      // silently drop it rather than crashing the process.
    }
  }
}
