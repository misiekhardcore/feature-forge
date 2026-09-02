import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { EOL } from "node:os";
import { join, resolve, sep } from "node:path";

/** One file tracked in the audit ledger. */
interface AuditEntry {
  readonly date: number;
  readonly name: string;
  readonly hash: string;
}

/**
 * Persistent audit state. The shape mirrors the OMP rotating-file audit so
 * tooling written against the OMP ledger stays compatible.
 */
interface AuditState {
  readonly keep: { readonly days: false; readonly amount: number };
  readonly auditLog: string;
  readonly files: AuditEntry[];
  readonly hashType: "sha256";
}

/** Configuration for a {@link RotatingFileSink}. */
export interface RotatingFileSinkOptions {
  /** Directory that holds the rotated files. */
  directory: string;
  /** Leading filename component, e.g. "forge" for the logger or an agent id for a journal. */
  filenamePrefix: string;
  /** Trailing filename component, e.g. String(process.pid) for the logger or "journal". */
  filenameSuffix: string;
  /**
   * Rotate to a new segment once the active file exceeds this many bytes.
   * Must be a positive number.
   */
  maxBytes: number;
  /**
   * Maximum number of files kept by retention. In audit mode this bounds the
   * TOTAL number of files (the base file included). In day-less journal mode
   * it bounds the numeric segments only - the base segment is never removed.
   * Must be a non-negative number.
   */
  maxFiles: number;
  /**
   * Path of the persistent audit ledger. When set, retention is driven by
   * the ledger (OMP-compatible) and bounds the total file count including
   * the base file. Required when {@link dayRotation} is enabled. When
   * omitted (with dayRotation disabled), retention enumerates numeric
   * segments in the directory instead (journal mode).
   */
  auditFile?: string;
  /**
   * When true (default), the local day is part of the filename and a day
   * change resets the segment index to zero. Day-mode retention is driven
   * exclusively by the audit ledger, so enabling it requires
   * {@link auditFile}.
   */
  dayRotation?: boolean;
  /** File extension without the dot; defaults to "log". */
  extension?: string;
  /** Injectable clock for tests; defaults to `() => new Date()`. */
  now?: () => Date;
}

function isAuditEntry(value: unknown): value is AuditEntry {
  if (value === null || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.date === "number" &&
    typeof entry.name === "string" &&
    typeof entry.hash === "string"
  );
}

/**
 * Synchronous append sink with optional local-day and size rotation plus
 * bounded retention.
 *
 * Rotation ports the OMP rotating-file semantics: the active file is the
 * highest-index segment for the current day; once its byte count exceeds
 * {@link RotatingFileSinkOptions.maxBytes} the next segment becomes active
 * and subsequent writes go there.
 *
 * Retention depends on the mode:
 * - Audit mode (`auditFile` set): the OMP audit ledger tracks every file
 *   ever written and bounds the TOTAL number of files (the base file
 *   included) to {@link RotatingFileSinkOptions.maxFiles}, deleting the
 *   oldest tracked files first. This is the only retention mechanism that
 *   understands day-rotated names, so `dayRotation: true` (the default)
 *   requires an audit file.
 * - Journal mode (`dayRotation: false`, no `auditFile`): retention counts
 *   the numeric segments `prefix.suffix.ext.N` in the directory and removes
 *   the lowest indices until at most
 *   {@link RotatingFileSinkOptions.maxFiles} segments remain. The base
 *   segment `prefix.suffix.ext` is never removed by retention.
 *
 * `write` never throws - failures are reported through the boolean return
 * value so callers can degrade gracefully.
 */
export class RotatingFileSink {
  /**
   * Local calendar day key (`YYYY-MM-DD`) used in day-rotated filenames.
   *
   * Shared by the sink, {@link FileLogger} naming/prune patterns, and tests
   * so the filename format never drifts from the prune-time matching.
   */
  static dayKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate(),
    ).padStart(2, "0")}`;
  }

  private readonly directory: string;
  private readonly filenamePrefix: string;
  private readonly filenameSuffix: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private readonly auditFile: string | undefined;
  private readonly dayRotation: boolean;
  private readonly extension: string;
  private readonly now: () => Date;

  private files: AuditEntry[] = [];
  private activeDay: string | undefined;
  private activeIndex = 0;
  private activePath: string | undefined;
  private activeBytes = 0;
  private closed = false;

  constructor(options: RotatingFileSinkOptions) {
    if (!(options.maxBytes > 0)) {
      throw new Error(
        `RotatingFileSink: maxBytes must be a positive number, got ${options.maxBytes}`,
      );
    }
    if (!(options.maxFiles >= 0)) {
      throw new Error(
        `RotatingFileSink: maxFiles must be a non-negative number, got ${options.maxFiles}`,
      );
    }
    const dayRotation = options.dayRotation ?? true;
    if (dayRotation && options.auditFile === undefined) {
      throw new Error(
        "RotatingFileSink: dayRotation requires an auditFile - day-mode retention is driven " +
          "by the audit ledger only. Set dayRotation: false to use readdir-based segment " +
          "retention (journal mode).",
      );
    }

    this.directory = options.directory;
    this.filenamePrefix = options.filenamePrefix;
    this.filenameSuffix = options.filenameSuffix;
    this.maxBytes = options.maxBytes;
    this.maxFiles = options.maxFiles;
    this.auditFile = options.auditFile;
    this.dayRotation = dayRotation;
    this.extension = options.extension ?? "log";
    this.now = options.now ?? (() => new Date());

    try {
      mkdirSync(this.directory, { recursive: true });
    } catch {
      // An unusable directory is tolerated; write() reports failures.
    }

    if (this.auditFile !== undefined) {
      this.files = this.readAudit();
    }
    this.selectFile(RotatingFileSink.dayKey(this.now()));
  }

  /**
   * Append one already-formatted record.
   *
   * The record is written with the platform line ending appended. Rotation
   * is evaluated before the append: a record that would push the active file
   * past `maxBytes` starts a new segment instead.
   *
   * @returns `true` when the record was appended, `false` after {@link close}
   *   or when any filesystem operation failed (best-effort, never throws).
   */
  write(line: string): boolean {
    if (this.closed) return false;
    const now = this.now();
    const createdSegment = this.selectFile(RotatingFileSink.dayKey(now));
    // selectFile always resolves a concrete path, so the local is never undefined.
    const activePath = this.activePath!;
    const record = `${line}${EOL}`;
    try {
      appendFileSync(activePath, record, "utf8");
    } catch {
      return false;
    }
    this.activeBytes += Buffer.byteLength(record);
    this.registerFile(activePath, now.getTime());
    if (createdSegment && this.auditFile === undefined) {
      this.retainSegments();
    }
    return true;
  }

  /**
   * Stop accepting records. Writes after close are no-ops returning `false`.
   * Synchronous writes require no drain phase.
   */
  close(): void {
    this.closed = true;
  }

  /**
   * Resolve the active segment for `day` and return whether a new segment
   * index was opened (rotation).
   */
  private selectFile(day: string): boolean {
    let createdSegment = false;
    if (day !== this.activeDay) {
      const firstSelection = this.activeDay === undefined;
      this.activeDay = day;
      if (this.dayRotation) {
        // Day mode: the day is part of the filename, so a new day starts a
        // fresh base segment with the index reset.
        this.activeIndex = 0;
        this.setActivePath(day, 0);
      } else if (firstSelection) {
        // Journal mode first selection: the day is not part of the filename
        // and segments are strictly ordered (0 = oldest), so appends must
        // resume at the NEWEST existing segment. Walking up from index 0
        // would recreate evicted low indices and interleave new records
        // before older segments.
        this.activeIndex = this.findHighestSegmentIndex();
        this.setActivePath(day, this.activeIndex);
      }
      // Later day changes in journal mode never move the active segment:
      // a reset would reuse low indices that already hold records (or were
      // evicted by retention), breaking the chronological 0->N segment
      // order that replay depends on.
    }
    while (this.activeBytes > this.maxBytes) {
      this.activeIndex++;
      this.setActivePath(day, this.activeIndex);
      createdSegment = true;
    }
    return createdSegment;
  }

  /**
   * Highest existing numeric segment index in journal mode, or 0 when no
   * segments exist yet (the base segment). Only canonical, non-zero-padded
   * indexes count; foreign names like `.01` would alias `.1`.
   */
  private findHighestSegmentIndex(): number {
    const base = this.baseName();
    let entries: string[];
    try {
      entries = readdirSync(this.directory);
    } catch {
      return 0;
    }
    let highest = 0;
    for (const entry of entries) {
      if (!entry.startsWith(`${base}.`)) continue;
      const indexPart = entry.slice(base.length + 1);
      if (/^(?:0|[1-9]\d*)$/.test(indexPart)) {
        highest = Math.max(highest, Number(indexPart));
      }
    }
    return highest;
  }

  private setActivePath(day: string, index: number): void {
    const suffix = index === 0 ? "" : `.${index}`;
    const extensionPart = this.extension ? `.${this.extension}` : "";
    const name = this.dayRotation
      ? `${this.filenamePrefix}.${day}.${this.filenameSuffix}${extensionPart}${suffix}`
      : `${this.baseName()}${suffix}`;
    this.activePath = join(this.directory, name);
    try {
      this.activeBytes = statSync(this.activePath).size;
    } catch {
      this.activeBytes = 0;
    }
  }

  /**
   * Base filename of the index-0 segment for the configured mode:
   * `prefix.day.suffix.ext` in day mode, `prefix.suffix.ext` otherwise.
   * An empty suffix (explicit-path FileLogger contract) and an empty
   * extension (extensionless explicit path) omit their dots.
   */
  private baseName(): string {
    const suffixPart = this.filenameSuffix ? `.${this.filenameSuffix}` : "";
    const extensionPart = this.extension ? `.${this.extension}` : "";
    return `${this.filenamePrefix}${suffixPart}${extensionPart}`;
  }

  /**
   * Track `filePath` in the audit ledger (once per file) and enforce
   * retention: while the tracked count exceeds `maxFiles`, the oldest entry
   * is removed from disk and from the ledger. The ledger is persisted after
   * every change.
   */
  private registerFile(filePath: string, date: number): void {
    if (this.auditFile === undefined) return;
    if (this.files.some((file) => file.name === filePath)) return;
    const hash = createHash("sha256").update(`${filePath}LOG_FILE${date}`).digest("hex");
    this.files.push({ date, name: filePath, hash });
    while (this.files.length > this.maxFiles) {
      const removed = this.files.shift();
      if (!removed) break;
      if (!this.isWithinDirectory(removed.name)) {
        // A ledger entry pointing outside the sink's directory (tampered
        // ledger or a relocated sink) is dropped without touching the
        // target - retention must never delete what it does not own.
        continue;
      }
      try {
        rmSync(removed.name, { force: true });
      } catch {
        // Retention is best-effort; the current record must still be written.
      }
    }
    this.writeAudit();
  }

  /**
   * True when `target` resolves inside the sink's own directory.
   *
   * Guards audit-ledger removal: the ledger is a plain JSON file that can
   * be tampered with (or copied across machines), so every tracked path is
   * re-validated before deletion.
   */
  private isWithinDirectory(target: string): boolean {
    const resolvedTarget = resolve(target);
    const resolvedDirectory = resolve(this.directory);
    return (
      resolvedTarget === resolvedDirectory || resolvedTarget.startsWith(resolvedDirectory + sep)
    );
  }

  private readAudit(): AuditEntry[] {
    const auditFile = this.auditFile;
    if (auditFile === undefined) return [];
    try {
      const parsed = JSON.parse(readFileSync(auditFile, "utf8")) as { files?: unknown };
      return Array.isArray(parsed.files) ? parsed.files.filter(isAuditEntry) : [];
    } catch {
      return [];
    }
  }

  private writeAudit(): void {
    if (this.auditFile === undefined) return;
    const state: AuditState = {
      keep: { days: false, amount: this.maxFiles },
      auditLog: this.auditFile,
      files: this.files,
      hashType: "sha256",
    };
    try {
      writeFileSync(this.auditFile, JSON.stringify(state, undefined, 4), "utf8");
    } catch {
      // Audit persistence is best-effort; the log write must not fail because
      // the ledger could not be updated.
    }
  }

  /**
   * Journal-mode retention: after a new numeric segment is created, count the
   * segments matching `${prefix}.${suffix}.${extension}.N` in the directory
   * and remove the lowest indices until at most `maxFiles` remain.
   */
  private retainSegments(): void {
    let entries: string[];
    try {
      entries = readdirSync(this.directory);
    } catch {
      return;
    }
    const base = this.baseName();
    const indices: number[] = [];
    for (const entry of entries) {
      if (!entry.startsWith(`${base}.`)) continue;
      const indexPart = entry.slice(base.length + 1);
      // Canonical, non-zero-padded indexes only: `.01` would alias `.1`
      // and skew the eviction count.
      if (/^(?:0|[1-9]\d*)$/.test(indexPart)) {
        indices.push(Number(indexPart));
      }
    }
    indices.sort((a, b) => a - b);
    while (indices.length > this.maxFiles) {
      const oldest = indices.shift();
      if (oldest === undefined) break;
      try {
        rmSync(join(this.directory, `${base}.${oldest}`), { force: true });
      } catch {
        // Best-effort retention; a failed removal must not surface.
      }
    }
  }
}
