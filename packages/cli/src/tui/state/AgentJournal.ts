import { createReadStream, type Dirent, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { createInterface } from "node:readline";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { DEFAULT_FORGE_CONFIG, jsonParse, logger, RotatingFileSink } from "@feature-forge/core";

/**
 * One persisted tool-log record (the journal's `tool` entry shape).
 *
 * Carries `args` on start-derived lines and `result` + `isError` on
 * end-derived lines (pi's end event carries no args); end-derived entries
 * may also carry `args` merged from the matching start entry (see
 * migrateLegacy JSDoc for the migration divergence). Exported so the
 * viewer's live tool cache can reference the same shape.
 */
export interface AgentToolEntry {
  toolCallId: string;
  toolName: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  ts: string;
}

/**
 * One persisted entry of an agent journal (JSONL contract, Phase B roadmap;
 * ADR 0023 documenting the format lands with S4).
 *
 * All entries carry an ISO `ts` stamp. `tool` entries carry `args` on
 * start-derived lines and `result` + `isError` on end-derived lines (pi's
 * end event carries no args); end-derived tool entries may also carry
 * `args` merged from the matching start entry (see migrateLegacy JSDoc
 * for the migration divergence). `forge` entries are part of the union
 * so replay tolerates them; no writer emits them yet.
 */
export type AgentJournalEntry =
  | {
      type: "lifecycle";
      phase: "started" | "done" | "error" | "cancelled";
      passed?: boolean;
      summary?: string;
      ts: string;
    }
  | { type: "message"; message: AgentMessage; ts: string }
  | ({ type: "tool" } & AgentToolEntry)
  | { type: "stream"; line: string; ts: string }
  | {
      type: "forge";
      phase: "loop-round" | "workspace-ready" | "session-set";
      details: Record<string, unknown>;
      ts: string;
    };

/**
 * Sink overrides for an {@link AgentJournal}.
 *
 * Tests pass small `maxBytes`/`maxFiles` values to exercise rotation and
 * segment-count retention without writing megabytes. When omitted, the
 * values fall back to the canonical retention defaults
 * (`DEFAULT_FORGE_CONFIG.logMaxBytes`/`logMaxFiles`) - the same
 * bounded-retention knobs as the file logger, so both persistence
 * surfaces share one retention policy. Configured values are threaded
 * explicitly by the composition side (AgentViewerState's
 * `journalRetention` option); this class never reads a config singleton.
 */
export interface AgentJournalOptions {
  /** Rotate to a new segment once the active file exceeds this many bytes. */
  maxBytes?: number;
  /**
   * Maximum numeric segments kept (the base segment is never removed).
   *
   * CAUTION: a value of 0 keeps only the base segment - rotation still
   * opens new segments, but each is evicted immediately by retention, so
   * history beyond the current segment is silently dropped. Prefer a value
   * of at least 1.
   */
  maxFiles?: number;
}

/**
 * Append-only JSONL journal for a single agent run.
 *
 * Writes are synchronous and best-effort (never throw). Reads are
 * line-by-line and tolerant of corrupted lines so replay can proceed
 * past partial writes.
 *
 * Large journals rotate through numeric segments: the base file is
 * segment 0 (oldest) and rotated segments `{base}.1`, `{base}.2`, ...
 * hold progressively newer entries. Retention keeps at most `maxFiles`
 * numeric segments, evicting the lowest indices - the base segment is
 * never removed. Reads replay 0 → N so append-order chronology is
 * preserved across segments.
 */
export class AgentJournal {
  readonly filePath: string;
  private readonly sink: RotatingFileSink;

  constructor(filePath: string, options: AgentJournalOptions = {}) {
    this.filePath = filePath;
    const maxBytes = options.maxBytes ?? DEFAULT_FORGE_CONFIG.logMaxBytes;
    const maxFiles = options.maxFiles ?? DEFAULT_FORGE_CONFIG.logMaxFiles;
    this.sink = AgentJournal.createSink(filePath, maxBytes, maxFiles);
  }

  /**
   * Create a journal for an agent under the shared stream directory.
   *
   * `options` carries the same sink overrides as the constructor; retention
   * is explicit here so callers never fall back to reading a config
   * singleton (the composition side threads configured values).
   */
  static forAgent(
    streamDir: string,
    agentId: string,
    options: AgentJournalOptions = {},
  ): AgentJournal {
    return new AgentJournal(join(streamDir, `${agentId}.journal.jsonl`), options);
  }

  /**
   * Append one entry to the journal.
   *
   * Best-effort: the entry is serialized and written through the rotating
   * sink (which creates the parent directory on first use and rotates
   * when the active segment exceeds `maxBytes`). Failures are logged and
   * swallowed so journaling never interrupts an agent run.
   *
   * Returns whether the entry was persisted. Migration callers use this
   * to decide whether their source files may be removed (see
   * {@link migrateLegacy}).
   */
  append(entry: AgentJournalEntry): boolean {
    try {
      // The sink appends the platform line ending itself.
      const persisted = this.sink.write(JSON.stringify(entry));
      if (!persisted) {
        logger.warn("AgentJournal.append: failed to append entry", {
          filePath: this.filePath,
          error: "sink write failed",
        });
      }
      return persisted;
    } catch (err) {
      logger.warn("AgentJournal.append: failed to append entry", {
        filePath: this.filePath,
        error: String(err),
      });
      return false;
    }
  }

  /**
   * Read all entries in append order (0 → N across segments).
   *
   * The base file (segment 0, oldest) is read first, then each numeric
   * segment in ascending index order (newest last). Missing intermediate
   * segments are normal (count retention evicts the lowest indices) and
   * are simply skipped.
   *
   * Tolerant replay: empty lines are skipped; lines that fail to parse
   * and lines that parse to JSON but do not match the entry union are
   * logged and skipped rather than aborting the read. The same tolerance
   * pass applies to every segment.
   *
   * `complete` reports whether every segment read reached EOF: false
   * when the base file could not be opened or any segment stream failed
   * mid-read (a truncated journal), true otherwise - including an empty
   * journal and reads that skipped corrupt lines. Per-line parse
   * failures never make the read incomplete, because the read still
   * reaches EOF.
   */
  async read(): Promise<{ entries: AgentJournalEntry[]; complete: boolean }> {
    const entries: AgentJournalEntry[] = [];
    let complete = true;
    for (const segmentPath of this.segmentPaths()) {
      const result = await this.readFile(segmentPath);
      entries.push(...result.entries);
      complete = complete && result.complete;
    }
    return { entries, complete };
  }

  /**
   * Segment read order for the journal: the base file first, then each
   * existing numeric segment in ascending index order.
   *
   * Only canonical, non-zero-padded indexes count (`.01` would alias
   * `.1`); missing intermediate segments are skipped - retention evicts
   * the lowest indices, so a gap between the base and the newest segment
   * is a normal state, never an error.
   */
  private segmentPaths(): string[] {
    const base = basename(this.filePath);
    let entries: Dirent[];
    try {
      entries = readdirSync(dirname(this.filePath), { withFileTypes: true });
    } catch {
      // Unreadable directory: fall back to reading the base file alone so
      // the missing-base contract (entries [], complete false) holds.
      return [this.filePath];
    }

    const indices: number[] = [];
    for (const entry of entries) {
      // Only regular files are segment candidates: a directory whose name
      // matches `{base}.N` (e.g. a workspace collision) must never be read
      // as a segment, so it cannot break the replay.
      if (!entry.isFile()) continue;
      if (!entry.name.startsWith(`${base}.`)) continue;
      const indexPart = entry.name.slice(base.length + 1);
      if (/^(?:0|[1-9]\d*)$/.test(indexPart)) {
        indices.push(Number(indexPart));
      }
    }
    indices.sort((a, b) => a - b);
    return [this.filePath, ...indices.map((index) => `${this.filePath}.${index}`)];
  }

  /**
   * Tolerant line-by-line read of one segment file.
   *
   * Empty lines are skipped; lines that fail to parse and lines that
   * parse to JSON but do not match the entry union are logged and
   * skipped rather than aborting the read. `complete` is false only when
   * the file could not be opened or the stream failed mid-read.
   */
  private async readFile(
    filePath: string,
  ): Promise<{ entries: AgentJournalEntry[]; complete: boolean }> {
    const entries: AgentJournalEntry[] = [];
    try {
      const rl = createInterface({
        input: createReadStream(filePath, "utf-8"),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line) continue;
        try {
          const value = jsonParse<unknown>(line);
          if (!AgentJournal.isAgentJournalEntry(value)) {
            logger.warn("AgentJournal.read: skipped structurally invalid journal line", {
              filePath,
            });
            continue;
          }
          entries.push(value);
        } catch (err) {
          logger.warn("AgentJournal.read: failed to parse journal line", {
            filePath,
            error: String(err),
          });
        }
      }
    } catch (err) {
      logger.warn("AgentJournal.read: failed to read journal file", {
        filePath,
        error: String(err),
      });
      return { entries, complete: false };
    }
    return { entries, complete: true };
  }

  /**
   * Journal-mode sink for an explicit base path: writes to exactly
   * `filePath` as the index-0 segment, no day rotation, no audit ledger.
   * Mirrors FileLogger.createExplicitSink so the journal base file is
   * byte-for-byte the given path and segments derive as `{base}.N`.
   */
  private static createSink(
    filePath: string,
    maxBytes: number,
    maxFiles: number,
  ): RotatingFileSink {
    const extension = extname(filePath).slice(1);
    return new RotatingFileSink({
      directory: dirname(filePath),
      filenamePrefix: basename(filePath, extension ? `.${extension}` : ""),
      filenameSuffix: "",
      extension,
      dayRotation: false,
      maxBytes,
      maxFiles,
    });
  }

  /**
   * One-shot migration from the legacy per-agent files (.messages.jsonl,
   * .events.jsonl, .stream) into the journal.
   *
   * `events` accepts the rotated archive: paths are derived in file-mtime
   * order (stable - ties keep the caller's array order), so callers may
   * pass them in any order; per-file line order is preserved, and the
   * journal receives the entries in messages → tools → stream order
   * using each source file's mtime as the entry `ts`. Legacy files are
   * then removed best-effort. Idempotent: a
   * second call finds no legacy files and is a no-op.
   *
   * Operational constraint: must not run while a writer is still
   * appending to the legacy files (a live agent session). The caller is
   * expected to migrate at startup, before any new writer starts (see
   * prepopulateStreamFiles).
   *
   * Divergence from the live writer: the live writer merges the args
   * captured at tool_execution_start into the paired tool_execution_end
   * entry via an in-memory map; migration derives end entries without
   * `args` because start/end pairing crosses independent file lines.
   * Replay consumers pair the two `tool` entries per `toolCallId`
   * themselves (start = args, end = result + isError).
   *
   * Delivery is at-least-once on crash: entries are appended to the
   * journal before legacy files are removed, so a crash between the two
   * leaves the legacy files in place and a retry re-appends the same
   * entries (duplicates are possible). This is deliberate - losing data
   * is worse than duplicating it.
   *
   * The same guarantee covers append failure: if any append does not
   * persist, every source file is left in place (the unlink phase is
   * skipped entirely) so a retry can re-migrate them.
   *
   * Data-safety: a legacy file is only derived from and removed when its
   * read reaches EOF. A file that could not be fully read is skipped and
   * left in place so a later retry can migrate it, rather than destroying
   * data after a partial copy.
   */
  async migrateLegacy(legacy: {
    stream?: string;
    events?: string[];
    messages?: string;
  }): Promise<void> {
    const sources: Array<{ kind: "messages" | "events" | "stream"; path: string; mtime: Date }> =
      [];
    const collect = (kind: "messages" | "events" | "stream", path: string): void => {
      try {
        sources.push({ kind, path, mtime: statSync(path).mtime });
      } catch {
        logger.warn("AgentJournal.migrateLegacy: failed to stat legacy file, skipping", { path });
      }
    };

    if (legacy.messages) collect("messages", legacy.messages);
    for (const path of legacy.events ?? []) collect("events", path);
    if (legacy.stream) collect("stream", legacy.stream);
    if (sources.length === 0) return;

    // Events paths are derived oldest-first by file mtime regardless of
    // the order the caller passed them in (e.g. [current, archive] still
    // derives the archive first). The events block sits between the
    // single messages and stream sources, so sorting it in place keeps
    // the messages → tools → stream derivation order. Array#sort is
    // stable, so same-mtime ties keep the caller's array order.
    const firstEvent = sources.findIndex((source) => source.kind === "events");
    if (firstEvent !== -1) {
      const eventsBlock = sources.filter((source) => source.kind === "events");
      eventsBlock.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
      sources.splice(firstEvent, eventsBlock.length, ...eventsBlock);
    }

    const derived: AgentJournalEntry[] = [];
    const migrated: string[] = [];
    for (const { kind, path, mtime } of sources) {
      const ts = mtime.toISOString();
      const { lines, complete } = await this.readLines(path);
      if (!complete) {
        logger.warn("AgentJournal.migrateLegacy: skipped legacy file, read did not reach EOF", {
          path,
        });
        continue;
      }
      migrated.push(path);

      switch (kind) {
        case "messages":
          for (const line of lines) {
            try {
              this.pushDerived(
                derived,
                { type: "message", message: jsonParse<AgentMessage>(line), ts },
                path,
              );
            } catch (err) {
              logger.warn("AgentJournal.migrateLegacy: failed to parse message line", {
                path,
                error: String(err),
              });
            }
          }
          break;

        case "events":
          for (const line of lines) {
            try {
              const event = jsonParse<JsonAgentSessionEvent>(line);
              if (
                event === null ||
                typeof event !== "object" ||
                typeof (event as { type?: unknown }).type !== "string"
              ) {
                logger.warn("AgentJournal.migrateLegacy: skipped structurally invalid event line", {
                  path,
                });
                continue;
              }
              if (event.type === "tool_execution_start") {
                this.pushDerived(
                  derived,
                  {
                    type: "tool",
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    args: event.args,
                    ts,
                  },
                  path,
                );
              } else if (event.type === "tool_execution_end") {
                this.pushDerived(
                  derived,
                  {
                    type: "tool",
                    toolCallId: event.toolCallId,
                    toolName: event.toolName,
                    result: event.result,
                    isError: event.isError,
                    ts,
                  },
                  path,
                );
              }
            } catch (err) {
              logger.warn("AgentJournal.migrateLegacy: failed to parse event line", {
                path,
                error: String(err),
              });
            }
          }
          break;

        case "stream":
          for (const line of lines) {
            derived.push({ type: "stream", line, ts });
          }
          break;
      }
    }

    let appendsOk = true;
    for (const entry of derived) {
      if (!this.append(entry)) appendsOk = false;
    }

    // Best-effort removal of fully migrated files only: the journal file
    // already holds their data, so a failed unlink must not fail the
    // migration. When any append failed, keep every source file in place
    // so a retry can re-migrate (at-least-once, never at-most-once).
    if (!appendsOk) return;

    for (const path of migrated) {
      try {
        unlinkSync(path);
      } catch (err) {
        logger.warn("AgentJournal.migrateLegacy: failed to remove legacy file", {
          path,
          error: String(err),
        });
      }
    }
  }

  /**
   * Push a derived entry into the pending list, or warn and skip it when
   * it does not match the entry union (tolerant-replay contract).
   */
  private pushDerived(derived: AgentJournalEntry[], entry: AgentJournalEntry, path: string): void {
    if (!AgentJournal.isAgentJournalEntry(entry)) {
      logger.warn("AgentJournal.migrateLegacy: skipped structurally invalid legacy line", { path });
      return;
    }
    derived.push(entry);
  }

  /**
   * Structural guard for the entry union: an entry is replayable only
   * when it is an object whose `type` discriminates a known member and
   * that member's required fields are present.
   *
   * Member checks are presence/type-only, not deep shape validation:
   * a `message` member needs an object with a string `role`, a `tool`
   * member needs string `toolCallId`/`toolName`, and nested content is
   * trusted as written (the journal is the writer's own output).
   */
  private static isAgentJournalEntry(value: unknown): value is AgentJournalEntry {
    if (value === null || typeof value !== "object") return false;
    const entry = value as Record<string, unknown>;
    if (typeof entry.type !== "string" || typeof entry.ts !== "string") return false;
    switch (entry.type) {
      case "lifecycle":
        return (
          entry.phase === "started" ||
          entry.phase === "done" ||
          entry.phase === "error" ||
          entry.phase === "cancelled"
        );
      case "message":
        return (
          entry.message !== null &&
          typeof entry.message === "object" &&
          typeof (entry.message as { role?: unknown }).role === "string"
        );
      case "tool":
        return typeof entry.toolCallId === "string" && typeof entry.toolName === "string";
      case "stream":
        return typeof entry.line === "string";
      case "forge":
        return (
          (entry.phase === "loop-round" ||
            entry.phase === "workspace-ready" ||
            entry.phase === "session-set") &&
          entry.details !== null &&
          typeof entry.details === "object"
        );
      default:
        return false;
    }
  }

  /**
   * Stream a text file line by line, skipping empty lines.
   *
   * Reports whether the read reached EOF so callers can distinguish a
   * complete read from a partial one (e.g. when deciding whether a source
   * file may be removed).
   */
  private async readLines(filePath: string): Promise<{ lines: string[]; complete: boolean }> {
    const lines: string[] = [];
    try {
      const rl = createInterface({
        input: createReadStream(filePath, "utf-8"),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line) continue;
        lines.push(line);
      }
      return { lines, complete: true };
    } catch (err) {
      logger.warn("AgentJournal.readLines: failed to read file", {
        filePath,
        error: String(err),
      });
      return { lines, complete: false };
    }
  }
}
