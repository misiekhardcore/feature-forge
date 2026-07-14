import { createWriteStream, existsSync, mkdirSync, type WriteStream } from "node:fs";
import path from "node:path";

import { DEFAULT_FORGE_CONFIG, ForgeConfig } from "../config";
import { Logger } from "./Logger";
import { LogLevel } from "./LogLevel";

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
    return logger;
  }

  static getDefaultLogFilePath(): string {
    const logDir = FileLogger.resolveLogDir();
    return path.join(logDir, `${Date.now()}-${process.pid}.log`);
  }

  private static resolveLogDir(): string {
    return ForgeConfig.getInstance()?.getLogDir() ?? DEFAULT_FORGE_CONFIG.logDir!;
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

    if (!this.shouldLog(level, this.resolveLogLevel())) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel[level].toLowerCase(),
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
