import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { logger } from "@feature-forge/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { assistantMessage, text, userMessage } from "../test-utils";
import type { AgentJournalEntry } from "./AgentJournal";
import { AgentJournal } from "./AgentJournal";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "forge-journal-"));
}

const TS = "2025-01-01T00:00:00.000Z";
const LATER_TS = "2025-01-02T00:00:00.000Z";

describe("AgentJournal", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup.
      }
    }
  });

  function newTempDir(): string {
    const dir = makeTempDir();
    tempDirs.push(dir);
    return dir;
  }

  it("roundtrips every entry type in order", async () => {
    const journal = new AgentJournal(join(newTempDir(), "agent.journal.jsonl"));
    const entries: AgentJournalEntry[] = [
      { type: "lifecycle", phase: "started", ts: TS },
      { type: "message", message: userMessage([text("hello")]), ts: TS },
      { type: "tool", toolCallId: "tc-1", toolName: "bash", args: { cmd: "ls" }, ts: TS },
      {
        type: "tool",
        toolCallId: "tc-2",
        toolName: "bash",
        result: "done",
        isError: false,
        ts: TS,
      },
      { type: "stream", line: "stream line", ts: TS },
      { type: "forge", phase: "loop-round", details: { round: 1 }, ts: TS },
    ];

    for (const entry of entries) {
      expect(journal.append(entry)).toBe(true);
    }

    const { entries: readEntries, complete } = await journal.read();
    expect(readEntries).toEqual(entries);
    expect(complete).toBe(true);
  });

  it("roundtrips alternate lifecycle and forge phases", async () => {
    const journal = new AgentJournal(join(newTempDir(), "agent.journal.jsonl"));
    const entries: AgentJournalEntry[] = [
      { type: "lifecycle", phase: "done", passed: true, summary: "ok", ts: TS },
      { type: "lifecycle", phase: "error", passed: false, summary: "boom", ts: TS },
      { type: "lifecycle", phase: "cancelled", ts: TS },
      { type: "forge", phase: "workspace-ready", details: { path: "/tmp/ws" }, ts: TS },
      { type: "forge", phase: "session-set", details: { id: "s-1" }, ts: TS },
    ];

    for (const entry of entries) {
      expect(journal.append(entry)).toBe(true);
    }

    const { entries: readEntries, complete } = await journal.read();
    expect(readEntries).toEqual(entries);
    expect(complete).toBe(true);
  });

  it("tolerates a corrupted trailing line", async () => {
    const journal = new AgentJournal(join(newTempDir(), "agent.journal.jsonl"));
    const valid: AgentJournalEntry = { type: "stream", line: "ok", ts: TS };
    journal.append(valid);
    writeFileSync(
      journal.filePath,
      `${readFileSync(journal.filePath, "utf-8")}not-json\n`,
      "utf-8",
    );

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const { entries, complete } = await journal.read();
      expect(entries).toEqual([valid]);
      expect(complete).toBe(true);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("skips structurally invalid journal lines with a warning per line", async () => {
    const journal = new AgentJournal(join(newTempDir(), "agent.journal.jsonl"));
    writeFileSync(
      journal.filePath,
      [
        JSON.stringify({ type: "stream", line: "a", ts: TS }),
        "", // interior empty line is tolerated, not warned
        "null",
        "42",
        "{}",
        JSON.stringify({ type: "stream" }), // missing `line` (and `ts`)
      ].join("\n") + "\n",
      "utf-8",
    );

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const { entries, complete } = await journal.read();
      expect(entries).toEqual([{ type: "stream", line: "a", ts: TS }]);
      expect(complete).toBe(true);
      expect(warnSpy).toHaveBeenCalledTimes(4);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("skips lines whose type is not in the entry union", async () => {
    const journal = new AgentJournal(join(newTempDir(), "agent.journal.jsonl"));
    writeFileSync(
      journal.filePath,
      [
        JSON.stringify({ type: "stream", line: "a", ts: TS }),
        JSON.stringify({ type: "bogus", ts: TS }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const { entries, complete } = await journal.read();
      expect(entries).toEqual([{ type: "stream", line: "a", ts: TS }]);
      expect(complete).toBe(true);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("returns an empty array for an empty file", async () => {
    const journal = new AgentJournal(join(newTempDir(), "agent.journal.jsonl"));
    writeFileSync(journal.filePath, "", "utf-8");

    const { entries, complete } = await journal.read();
    expect(entries).toEqual([]);
    expect(complete).toBe(true);
  });

  it("returns an empty array for a missing journal file and warns", async () => {
    const journal = new AgentJournal(join(newTempDir(), "never-written.journal.jsonl"));

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const { entries, complete } = await journal.read();
      expect(entries).toEqual([]);
      // Missing file = the stream never opened: the read did not reach
      // EOF, so the journal is not "complete". Callers must distinguish
      // this from a truncated existing journal via existence separately.
      expect(complete).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("returns entries [] and complete false when the journal directory is unreadable", async () => {
    const dir = newTempDir();
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "a regular file, not a directory", "utf-8");
    const journal = new AgentJournal(join(blocker, "agent.journal.jsonl"));

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const { entries, complete } = await journal.read();
      expect(entries).toEqual([]);
      // The segment directory could not be listed, so the base file cannot
      // be read: same incomplete contract as a missing journal.
      expect(complete).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("rotates to numeric segments on overflow and reads all entries in order", async () => {
    const dir = newTempDir();
    const journal = new AgentJournal(join(dir, "agent.journal.jsonl"), {
      maxBytes: 200,
      maxFiles: 3,
    });
    const entries: AgentJournalEntry[] = [];
    // Each entry is ~128 bytes: two fill the base past maxBytes, so the
    // third append opens segment .1, the fifth opens .2, etc.
    for (let i = 0; i < 6; i++) {
      const entry: AgentJournalEntry = {
        type: "stream",
        line: `line-${String(i).padStart(2, "0")}-${"x".repeat(60)}`,
        ts: TS,
      };
      entries.push(entry);
      expect(journal.append(entry)).toBe(true);
    }

    // The base file (segment 0, oldest) and the first rotated segments
    // exist; segments are derived from the base name ({base}.N).
    const base = join(dir, "agent.journal.jsonl");
    expect(existsSync(base)).toBe(true);
    expect(existsSync(`${base}.1`)).toBe(true);
    expect(existsSync(`${base}.2`)).toBe(true);

    // read() replays 0 → N: every entry comes back in append order.
    const { entries: readEntries, complete } = await journal.read();
    expect(readEntries).toEqual(entries);
    expect(complete).toBe(true);
  });

  it("evicts the oldest numeric segments beyond maxFiles but never the base", async () => {
    const dir = newTempDir();
    const journal = new AgentJournal(join(dir, "agent.journal.jsonl"), {
      maxBytes: 200,
      maxFiles: 2,
    });
    const entries: AgentJournalEntry[] = [];
    for (let i = 0; i < 20; i++) {
      const entry: AgentJournalEntry = {
        type: "stream",
        line: `line-${String(i).padStart(2, "0")}-${"x".repeat(60)}`,
        ts: TS,
      };
      entries.push(entry);
      expect(journal.append(entry)).toBe(true);
    }

    const base = join(dir, "agent.journal.jsonl");
    // Journal-mode retention removes the lowest numeric indices only:
    // the base segment is never evicted, the oldest rotated segment is.
    expect(existsSync(base)).toBe(true);
    expect(existsSync(`${base}.1`)).toBe(false);
    const segments = readdirSync(dir)
      .filter((name) => /^agent\.journal\.jsonl\.\d+$/.test(name))
      .sort();
    expect(segments).toHaveLength(2);

    // Evicted history is gone for good (same tradeoff as the OMP logger):
    // read() replays the surviving segments - the base (oldest) plus the
    // two newest segments holding the latest entries, in append order.
    const { entries: readEntries, complete } = await journal.read();
    expect(readEntries).toEqual([...entries.slice(0, 2), ...entries.slice(-4)]);
    expect(complete).toBe(true);
  });

  it("ignores a directory named {base}.N when discovering segments", async () => {
    const dir = newTempDir();
    const journal = new AgentJournal(join(dir, "agent.journal.jsonl"));
    const valid: AgentJournalEntry = { type: "stream", line: "base-ok", ts: TS };
    journal.append(valid);
    // A stray directory with a segment-shaped name (e.g. a workspace
    // collision) must not be treated as a segment: the isFile filter skips
    // it, so the base read stays complete and no directory is opened.
    mkdirSync(`${journal.filePath}.1`, { recursive: true });

    const { entries, complete } = await journal.read();
    expect(entries).toEqual([valid]);
    expect(complete).toBe(true);
  });

  it("tolerates corrupt lines across segments (warn per line, complete stays true)", async () => {
    const dir = newTempDir();
    const journal = new AgentJournal(join(dir, "agent.journal.jsonl"));
    const base = join(dir, "agent.journal.jsonl");
    const validBase: AgentJournalEntry = { type: "stream", line: "base-ok", ts: TS };
    const validSegment: AgentJournalEntry = { type: "stream", line: "segment-ok", ts: TS };
    writeFileSync(base, `${JSON.stringify(validBase)}\nnot-json-base\n`, "utf-8");
    writeFileSync(`${base}.1`, `not-json-segment\n${JSON.stringify(validSegment)}\n`, "utf-8");

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const { entries, complete } = await journal.read();
      // Valid lines from both segments survive; each corrupt line is
      // warned and skipped; the read still reaches EOF in every segment.
      expect(entries).toEqual([validBase, validSegment]);
      expect(complete).toBe(true);
      expect(warnSpy).toHaveBeenCalledTimes(2);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("migrates legacy stream, messages, and events files into the journal", async () => {
    const dir = newTempDir();
    const journal = new AgentJournal(join(dir, "builder.journal.jsonl"));

    const streamPath = join(dir, "builder.stream");
    const messagesPath = join(dir, "builder.messages.jsonl");
    const eventsPath = join(dir, "builder.events.jsonl");

    writeFileSync(streamPath, "line one\nline two\n", "utf-8");

    const msg1: AgentMessage = userMessage([text("hi")]);
    const msg2: AgentMessage = assistantMessage([text("hello")]);
    writeFileSync(messagesPath, `${JSON.stringify(msg1)}\n${JSON.stringify(msg2)}\n`, "utf-8");

    const startEvent: JsonAgentSessionEvent = {
      type: "tool_execution_start",
      toolCallId: "tc-1",
      toolName: "bash",
      args: { cmd: "ls" },
    };
    const endEvent: JsonAgentSessionEvent = {
      type: "tool_execution_end",
      toolCallId: "tc-1",
      toolName: "bash",
      result: "file listing",
      isError: false,
    };
    const unrelated: JsonAgentSessionEvent = { type: "message_start", message: msg1 };
    const eventLines = [startEvent, endEvent, unrelated]
      .map((event) => JSON.stringify(event))
      .join("\n");
    writeFileSync(eventsPath, `${eventLines}\n`, "utf-8");

    await journal.migrateLegacy({
      stream: streamPath,
      events: [eventsPath],
      messages: messagesPath,
    });

    const { entries } = await journal.read();
    expect(entries.filter((e) => e.type === "message")).toHaveLength(2);
    expect(entries.filter((e) => e.type === "tool")).toHaveLength(2);
    expect(entries.filter((e) => e.type === "stream")).toHaveLength(2);

    const [toolStart, toolEnd] = entries.filter(
      (e): e is Extract<AgentJournalEntry, { type: "tool" }> => e.type === "tool",
    );
    expect(toolStart).toMatchObject({
      type: "tool",
      toolCallId: "tc-1",
      toolName: "bash",
      args: { cmd: "ls" },
    });
    expect(toolEnd).toMatchObject({
      type: "tool",
      toolCallId: "tc-1",
      toolName: "bash",
      result: "file listing",
      isError: false,
    });

    // Entries are appended in messages → tools → stream order.
    const kinds = entries.map((e) => e.type);
    expect(kinds.indexOf("message")).toBeLessThan(kinds.indexOf("tool"));
    expect(kinds.indexOf("tool")).toBeLessThan(kinds.indexOf("stream"));

    // Legacy files are removed.
    expect(existsSync(streamPath)).toBe(false);
    expect(existsSync(messagesPath)).toBe(false);
    expect(existsSync(eventsPath)).toBe(false);

    // A second call finds no legacy files and is a no-op.
    await journal.migrateLegacy({
      stream: streamPath,
      events: [eventsPath],
      messages: messagesPath,
    });
    const { entries: secondRead } = await journal.read();
    expect(secondRead).toHaveLength(entries.length);
  });

  it("migrates a rotated events archive oldest-first with per-file ts", async () => {
    const dir = newTempDir();
    const journal = new AgentJournal(join(dir, "builder.journal.jsonl"));

    // Real rotation renames a capped `.events.jsonl` to `.events.1.jsonl`
    // and starts a fresh current file, so the archive holds the OLDER
    // events. The caller passes paths oldest-first: [archive, current].
    const eventsPath = join(dir, "builder.events.jsonl");
    const archivePath = join(dir, "builder.events.1.jsonl");
    const startEvent: JsonAgentSessionEvent = {
      type: "tool_execution_start",
      toolCallId: "tc-1",
      toolName: "bash",
      args: { cmd: "ls" },
    };
    const endEvent: JsonAgentSessionEvent = {
      type: "tool_execution_end",
      toolCallId: "tc-1",
      toolName: "bash",
      result: "file listing",
      isError: false,
    };
    writeFileSync(archivePath, `${JSON.stringify(startEvent)}\n`, "utf-8");
    writeFileSync(eventsPath, `${JSON.stringify(endEvent)}\n`, "utf-8");
    // Pin explicit mtimes so the per-file `ts` derivation and the
    // chronological ordering are observable, not timing-dependent.
    utimesSync(archivePath, new Date(TS), new Date(TS));
    utimesSync(eventsPath, new Date(LATER_TS), new Date(LATER_TS));

    await journal.migrateLegacy({ events: [archivePath, eventsPath] });

    const { entries } = await journal.read();
    const tools = entries.filter(
      (e): e is Extract<AgentJournalEntry, { type: "tool" }> => e.type === "tool",
    );
    expect(tools).toHaveLength(2);
    expect(tools[0]).toMatchObject({
      type: "tool",
      toolCallId: "tc-1",
      toolName: "bash",
      args: { cmd: "ls" },
    });
    expect(tools[0].result).toBeUndefined();
    expect(tools[0].ts).toBe(TS);
    expect(tools[1]).toMatchObject({
      type: "tool",
      toolCallId: "tc-1",
      toolName: "bash",
      result: "file listing",
      isError: false,
    });
    expect(tools[1].args).toBeUndefined();
    expect(tools[1].ts).toBe(LATER_TS);

    // Both legacy files (current + archive) are removed.
    expect(existsSync(eventsPath)).toBe(false);
    expect(existsSync(archivePath)).toBe(false);
  });

  it("derives rotated events oldest-first by file mtime, not caller order", async () => {
    const dir = newTempDir();
    const journal = new AgentJournal(join(dir, "builder.journal.jsonl"));

    const olderPath = join(dir, "builder.events.1.jsonl");
    const newerPath = join(dir, "builder.events.jsonl");
    const olderEvent: JsonAgentSessionEvent = {
      type: "tool_execution_start",
      toolCallId: "tc-old",
      toolName: "bash",
      args: { cmd: "ls" },
    };
    const newerEvent: JsonAgentSessionEvent = {
      type: "tool_execution_start",
      toolCallId: "tc-new",
      toolName: "bash",
      args: { cmd: "pwd" },
    };
    writeFileSync(olderPath, `${JSON.stringify(olderEvent)}\n`, "utf-8");
    writeFileSync(newerPath, `${JSON.stringify(newerEvent)}\n`, "utf-8");
    // Pin explicit mtimes so the mtime ordering is observable, not
    // timing-dependent: newerPath is strictly NEWER than olderPath.
    utimesSync(olderPath, new Date(TS), new Date(TS));
    utimesSync(newerPath, new Date(LATER_TS), new Date(LATER_TS));

    // The caller passes newest-first - the WRONG chronological order on
    // purpose. migrateLegacy must re-derive oldest-first by file mtime.
    await journal.migrateLegacy({ events: [newerPath, olderPath] });

    const { entries } = await journal.read();
    const tools = entries.filter(
      (e): e is Extract<AgentJournalEntry, { type: "tool" }> => e.type === "tool",
    );
    expect(tools).toHaveLength(2);
    // Older file derived first, despite being passed last.
    expect(tools[0]).toMatchObject({ type: "tool", toolCallId: "tc-old", ts: TS });
    expect(tools[1]).toMatchObject({ type: "tool", toolCallId: "tc-new", ts: LATER_TS });

    // Both legacy files (current + archive) are removed.
    expect(existsSync(newerPath)).toBe(false);
    expect(existsSync(olderPath)).toBe(false);
  });

  it("skips structurally invalid derived entries during migration", async () => {
    const dir = newTempDir();
    const journal = new AgentJournal(join(dir, "builder.journal.jsonl"));

    const messagesPath = join(dir, "builder.messages.jsonl");
    const eventsPath = join(dir, "builder.events.jsonl");
    const validMessage: AgentMessage = userMessage([text("hi")]);
    // `null` (message not an object), `42` (message not an object), an
    // interior empty line, then a valid message.
    writeFileSync(messagesPath, `null\n42\n\n${JSON.stringify(validMessage)}\n`, "utf-8");
    // Valid JSON but not a usable tool event: missing toolCallId/toolName,
    // plus structurally invalid values (null, 42, {}) that must be warned
    // and skipped rather than silently dropped. A legit non-tool event
    // (message_start) is a known-but-unrelated shape: silently skipped,
    // never warned.
    writeFileSync(
      eventsPath,
      [
        JSON.stringify({ type: "tool_execution_start" }),
        "null",
        "42",
        "{}",
        JSON.stringify({ type: "message_start", message: validMessage }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      await journal.migrateLegacy({ messages: messagesPath, events: [eventsPath] });

      const { entries } = await journal.read();
      expect(entries).toEqual([expect.objectContaining({ type: "message" })]);
      // Fully read sources are removed even when some lines were skipped.
      expect(existsSync(messagesPath)).toBe(false);
      expect(existsSync(eventsPath)).toBe(false);
      // 2 invalid message lines + 1 unusable tool event (missing members)
      // + 3 structurally invalid event values (null, 42, {}). The
      // message_start line is not a tool event and must stay silently
      // skipped - no warn, no derived entry.
      expect(warnSpy).toHaveBeenCalledTimes(6);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("warns but does not throw when a legacy file cannot be removed", async () => {
    const dir = newTempDir();
    const journal = new AgentJournal(join(dir, "builder.journal.jsonl"));

    // Listing the same path twice makes the second unlink fail (ENOENT).
    const messagesPath = join(dir, "builder.messages.jsonl");
    writeFileSync(messagesPath, `${JSON.stringify(userMessage([text("hi")]))}\n`, "utf-8");

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      await journal.migrateLegacy({ messages: messagesPath, stream: messagesPath });

      const { entries } = await journal.read();
      expect(entries.filter((e) => e.type === "message")).toHaveLength(1);
      expect(entries.filter((e) => e.type === "stream")).toHaveLength(1);
      expect(existsSync(messagesPath)).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("is a no-op when no legacy paths exist", async () => {
    const dir = newTempDir();
    const journal = new AgentJournal(join(dir, "builder.journal.jsonl"));

    await journal.migrateLegacy({
      stream: join(dir, "missing.stream"),
      events: [join(dir, "missing.events.jsonl")],
      messages: join(dir, "missing.messages.jsonl"),
    });

    expect(existsSync(journal.filePath)).toBe(false);
  });

  it("does not duplicate entries on a second migration call", async () => {
    const dir = newTempDir();
    const journal = new AgentJournal(join(dir, "builder.journal.jsonl"));

    const streamPath = join(dir, "builder.stream");
    const messagesPath = join(dir, "builder.messages.jsonl");
    writeFileSync(streamPath, "one\ntwo\n", "utf-8");
    writeFileSync(messagesPath, `${JSON.stringify(userMessage([text("hi")]))}\n`, "utf-8");

    await journal.migrateLegacy({ stream: streamPath, messages: messagesPath });
    const { entries: first } = await journal.read();
    expect(first).toHaveLength(3); // 1 message + 2 stream lines

    await journal.migrateLegacy({ stream: streamPath, messages: messagesPath });
    const { entries: second } = await journal.read();
    expect(second).toHaveLength(first.length);
  });

  it("tolerates corrupt lines when migrating and skips them", async () => {
    const dir = newTempDir();
    const journal = new AgentJournal(join(dir, "builder.journal.jsonl"));

    const messagesPath = join(dir, "builder.messages.jsonl");
    const eventsPath = join(dir, "builder.events.jsonl");
    const validMessage: AgentMessage = userMessage([text("hi")]);
    writeFileSync(messagesPath, `${JSON.stringify(validMessage)}\ngarbage-message\n`, "utf-8");
    const startEvent: JsonAgentSessionEvent = {
      type: "tool_execution_start",
      toolCallId: "tc-1",
      toolName: "bash",
      args: { cmd: "ls" },
    };
    writeFileSync(eventsPath, `not-json\n${JSON.stringify(startEvent)}\n`, "utf-8");

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      await journal.migrateLegacy({ messages: messagesPath, events: [eventsPath] });

      const { entries } = await journal.read();
      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({ type: "message" });
      expect(entries[1]).toMatchObject({ type: "tool", toolCallId: "tc-1" });
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("does not throw when the journal path's parent is a regular file", () => {
    const dir = newTempDir();
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "a regular file, not a directory", "utf-8");
    const journal = new AgentJournal(join(blocker, "agent.journal.jsonl"));

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      // A failed append reports false and never throws: journaling must
      // not interrupt the agent run.
      const result = journal.append({ type: "stream", line: "x", ts: TS });
      expect(result).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("keeps legacy files when an append fails during migration", async () => {
    const dir = newTempDir();
    // Journal path whose parent is a regular file, so every append fails.
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "a regular file, not a directory", "utf-8");
    const journal = new AgentJournal(join(blocker, "builder.journal.jsonl"));

    const messagesPath = join(dir, "builder.messages.jsonl");
    writeFileSync(messagesPath, `${JSON.stringify(userMessage([text("hi")]))}\n`, "utf-8");

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      await journal.migrateLegacy({ messages: messagesPath });

      // Nothing could be journaled, so the source must not be deleted:
      // a retry can re-migrate it (at-least-once, never at-most-once).
      expect(existsSync(journal.filePath)).toBe(false);
      expect(existsSync(messagesPath)).toBe(true);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("skips a legacy file whose read cannot reach EOF and leaves it in place", async () => {
    const dir = newTempDir();
    const journal = new AgentJournal(join(dir, "builder.journal.jsonl"));
    const legacyDir = join(dir, "legacy-dir");
    mkdirSync(legacyDir, { recursive: true });

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      await journal.migrateLegacy({ stream: legacyDir });

      expect(existsSync(legacyDir)).toBe(true);
      expect(existsSync(journal.filePath)).toBe(false);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("migrates legacy files with enough entries to overflow into segments", async () => {
    const dir = newTempDir();
    const journal = new AgentJournal(join(dir, "builder.journal.jsonl"), {
      maxBytes: 200,
      maxFiles: 5,
    });

    // ~129 bytes per derived entry: ten entries overflow the 200-byte base
    // segment, so migration itself drives rotation.
    const streamPath = join(dir, "builder.stream");
    const lines = Array.from(
      { length: 10 },
      (_, i) => `legacy-line-${String(i).padStart(2, "0")}-${"x".repeat(60)}`,
    );
    writeFileSync(streamPath, `${lines.join("\n")}\n`, "utf-8");

    await journal.migrateLegacy({ stream: streamPath });

    // Rotation happened: rotated segments exist alongside the base file.
    const base = join(dir, "builder.journal.jsonl");
    expect(existsSync(base)).toBe(true);
    const segments = readdirSync(dir).filter((name) => /^builder\.journal\.jsonl\.\d+$/.test(name));
    expect(segments.length).toBeGreaterThan(0);

    // Migrated entries replay in derivation order across the segments.
    const { entries } = await journal.read();
    expect(entries).toHaveLength(10);
    expect(entries.every((entry) => entry.type === "stream")).toBe(true);

    // Subsequent appends land after the migrated history and replay last.
    const extra: AgentJournalEntry = { type: "stream", line: "post-migration", ts: LATER_TS };
    expect(journal.append(extra)).toBe(true);
    const { entries: replayed } = await journal.read();
    expect(replayed).toHaveLength(11);
    expect(replayed[10]).toEqual(extra);

    // Legacy files are still removed after a successful migration.
    expect(existsSync(streamPath)).toBe(false);
  });

  it("composes the journal path from streamDir and agentId", () => {
    expect(AgentJournal.forAgent("/tmp/streams", "builder").filePath).toBe(
      join("/tmp/streams", "builder.journal.jsonl"),
    );
  });
});
