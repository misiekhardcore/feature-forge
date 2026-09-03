import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { logger } from "@feature-forge/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentDisplayHelpers } from "../display/AgentDisplayHelpers";
import {
  agentStartEvent,
  assistantMessage,
  messageEndEvent,
  messageStartEvent,
  messageUpdateEvent,
  text,
  toolResultMessage,
  turnEndEvent,
  turnStartEvent,
} from "../test-utils";
import type { AgentViewerEntry } from "../types";
import type { AgentJournalEntry, AgentToolEntry } from "./AgentJournal";
import { AgentViewerState } from "./AgentViewerState";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "agent-viewer-state-test-"));
}

// ── Event factories ─────────────────────────────────────────

function makeAgentStartEvent(): JsonAgentSessionEvent {
  return agentStartEvent();
}

function makeMessageEndEvent(content: string, role = "assistant"): JsonAgentSessionEvent {
  return messageEndEvent(
    role === "assistant"
      ? assistantMessage([text(content)])
      : { role: "user", content: [text(content)], timestamp: 0 },
  );
}

function makeMessageStartEvent(role = "assistant"): JsonAgentSessionEvent {
  return messageStartEvent(
    role === "assistant" ? assistantMessage() : { role: "user", content: [], timestamp: 0 },
  );
}

function makeMessageUpdateEvent(content: string): JsonAgentSessionEvent {
  return messageUpdateEvent(content);
}

function makeTurnStartEvent(): JsonAgentSessionEvent {
  return turnStartEvent();
}

function makeTurnEndEvent(): JsonAgentSessionEvent {
  return turnEndEvent();
}

// ── Format helper ───────────────────────────────────────────

function defaultFormat(event: JsonAgentSessionEvent): string {
  return `${event.type}: detail`;
}

/** Parse the journal file of an agent into typed entries ([] when absent). */
function readJournal(dir: string, agentId: string): AgentJournalEntry[] {
  const journalPath = join(dir, `${agentId}.journal.jsonl`);
  if (!existsSync(journalPath)) return [];
  return readFileSync(journalPath, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AgentJournalEntry);
}

// ── Tests ───────────────────────────────────────────────────

describe("AgentViewerState", () => {
  let state: AgentViewerState;

  beforeEach(() => {
    state = new AgentViewerState();
  });

  // ── entryCount / getAgentIds ──────────────────────────────

  describe("entryCount and getAgentIds", () => {
    it("starts with zero entries", () => {
      expect(state.entryCount).toBe(0);
      expect(state.getAgentIds()).toEqual([]);
    });

    it("tracks entries after update", () => {
      state.update({ id: "agent-a", status: "started", createdAt: new Date() });
      expect(state.entryCount).toBe(1);
      expect(state.getAgentIds()).toEqual(["agent-a"]);
    });
  });

  // ── update ─────────────────────────────────────────────────

  describe("update", () => {
    it("creates a new entry when agent id is new", () => {
      state.update({ id: "builder", status: "started", createdAt: new Date() });
      const entry = state.getAgentEntry("builder");
      expect(entry).toBeDefined();
      expect(entry!.status).toBe("started");
    });

    it("merges fields with existing entry when agent id already exists", () => {
      state.update({ id: "builder", status: "started", createdAt: new Date() });
      state.update({
        id: "builder",
        status: "done",
        summary: "Build passed",
        passed: true,
        createdAt: new Date(),
      });
      const entry = state.getAgentEntry("builder")!;
      expect(entry.status).toBe("done");
      expect(entry.summary).toBe("Build passed");
      if (entry.status === "done") {
        expect(entry.passed).toBe(true);
      }
    });

    it("preserves fields not overwritten by second update", () => {
      state.update({ id: "builder", status: "started", createdAt: new Date(), role: "builder" });
      state.update({
        id: "builder",
        status: "done",
        createdAt: new Date(),
        passed: false,
        summary: "",
      });
      const entry = state.getAgentEntry("builder");
      expect(entry!.role).toBe("builder");
    });

    it("stamps createdAt when entry omits it", () => {
      const before = new Date();
      state.update({ id: "builder", status: "started" } as AgentViewerEntry);
      const entry = state.getAgentEntry("builder")!;
      expect(entry.createdAt).toBeInstanceOf(Date);
      expect(entry.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it("preserves existing createdAt when subsequent update omits it", () => {
      const original = new Date("2026-01-01T00:00:00Z");
      state.update({ id: "builder", status: "started", createdAt: original });
      state.update({
        id: "builder",
        status: "done",
        passed: true,
        summary: "ok",
      } as AgentViewerEntry);
      expect(state.getAgentEntry("builder")!.createdAt).toBe(original);
    });

    it("entry createdAt wins over existing createdAt", () => {
      state.update({
        id: "builder",
        status: "started",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      });
      const newer = new Date("2026-02-01T00:00:00Z");
      state.update({ id: "builder", status: "started", createdAt: newer });
      expect(state.getAgentEntry("builder")!.createdAt).toBe(newer);
    });

    it("clears finishedAt for cancelled entries", () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-01-01T00:05:00Z"));
        state.update({
          id: "builder",
          status: "done",
          passed: true,
          summary: "ok",
          createdAt: new Date("2026-01-01T00:00:00Z"),
        });
        // Terminal done stamped a finishedAt; cancelled must clear a prior
        // stamp, not merely fail to add one.
        expect(state.getAgentEntry("builder")!.finishedAt).toBeInstanceOf(Date);

        state.update({ id: "builder", status: "cancelled", createdAt: new Date() });
        const entry = state.getAgentEntry("builder")!;
        expect(entry.finishedAt).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it("stamps finishedAt for error entries (terminal status)", () => {
      const before = new Date();
      state.update({
        id: "builder",
        status: "error",
        errorMessage: "Agent failed",
        createdAt: new Date(),
      });
      const entry = state.getAgentEntry("builder")!;
      expect(entry.finishedAt).toBeInstanceOf(Date);
      expect(entry.finishedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it("re-stamps finishedAt for error across a new run of the same agent id", () => {
      vi.useFakeTimers();
      try {
        // Iteration 1: "build" errors at 00:05.
        vi.setSystemTime(new Date("2026-01-01T00:05:00Z"));
        state.update({
          id: "build",
          status: "error",
          errorMessage: "Agent failed",
          createdAt: new Date("2026-01-01T00:00:00Z"),
        });
        expect(state.getAgentEntry("build")!.finishedAt!.getTime()).toBe(
          new Date("2026-01-01T00:05:00Z").getTime(),
        );

        // Iteration 2: the new run's started clears the stale stamp.
        vi.setSystemTime(new Date("2026-01-01T00:10:00Z"));
        state.update({ id: "build", status: "started", createdAt: new Date() });
        expect(state.getAgentEntry("build")!.finishedAt).toBeUndefined();

        // The new run's error re-stamps fresh — no freeze, no negative elapsed.
        state.update({
          id: "build",
          status: "error",
          errorMessage: "Agent failed again",
        } as AgentViewerEntry);
        const reErrored = state.getAgentEntry("build")!;
        expect(reErrored.finishedAt!.getTime()).toBe(new Date("2026-01-01T00:10:00Z").getTime());
        expect(
          reErrored.finishedAt!.getTime() - reErrored.createdAt.getTime(),
        ).toBeGreaterThanOrEqual(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("preserves finishedAt on a terminal re-delivery with a changed createdAt (restart path)", () => {
      vi.useFakeTimers();
      try {
        // Run 1 completes at 00:05.
        vi.setSystemTime(new Date("2026-01-01T00:05:00Z"));
        state.update({
          id: "builder",
          status: "done",
          passed: true,
          summary: "ok",
          createdAt: new Date("2026-01-01T00:00:00Z"),
        });
        expect(state.getAgentEntry("builder")!.finishedAt!.getTime()).toBe(
          new Date("2026-01-01T00:05:00Z").getTime(),
        );

        // After a restart, prepopulate replays the journal (createdAt from
        // the started lifecycle, finishedAt from the terminal) and connect()
        // then re-delivers done with the run-record createdAt — close to, but
        // not identical to, the replayed one. A changed createdAt alone must
        // NOT trigger a re-stamp: the existing stamp is the real finish time
        // and re-stamping would inflate elapsed by the whole downtime.
        vi.setSystemTime(new Date("2026-01-01T03:00:00Z"));
        state.update({
          id: "builder",
          status: "done",
          passed: true,
          summary: "ok",
          createdAt: new Date("2026-01-01T00:00:00.005Z"),
        });
        const entry = state.getAgentEntry("builder")!;
        expect(entry.status).toBe("done");
        expect(entry.finishedAt!.getTime()).toBe(new Date("2026-01-01T00:05:00Z").getTime());
        // Elapsed stays at the real run duration, not the reopen time.
        expect(entry.finishedAt!.getTime() - entry.createdAt.getTime()).toBeLessThan(
          10 * 60 * 1000,
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("preserves existing finishedAt on same-run terminal re-delivery (overlay reopen)", () => {
      vi.useFakeTimers();
      try {
        const createdAt = new Date("2026-01-01T00:00:00Z");
        vi.setSystemTime(new Date("2026-01-01T00:05:00Z"));
        state.update({
          id: "build",
          status: "done",
          passed: true,
          summary: "ok",
          createdAt,
        });
        const runFinishedAt = state.getAgentEntry("build")!.finishedAt!;
        expect(runFinishedAt.getTime()).toBe(new Date("2026-01-01T00:05:00Z").getTime());

        // The overlay re-delivers done for still-Completed agents on every
        // reopen with the same agent.createdAt and no finishedAt. The stamp
        // must be preserved — elapsed stays at the real run duration instead
        // of inflating to reopen-time.
        vi.setSystemTime(new Date("2026-01-01T03:00:00Z"));
        state.update({
          id: "build",
          status: "done",
          passed: true,
          summary: "ok",
          createdAt,
        });
        const redelivered = state.getAgentEntry("build")!;
        expect(redelivered.finishedAt!.getTime()).toBe(runFinishedAt.getTime());
      } finally {
        vi.useRealTimers();
      }
    });

    it("clears finishedAt across loop iterations that re-run the same agent id", () => {
      vi.useFakeTimers();
      try {
        // Iteration 1: "build" starts and completes.
        vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
        state.update({ id: "build", status: "started", createdAt: new Date() });
        state.update({
          id: "build",
          status: "done",
          passed: true,
          summary: "ok",
        } as AgentViewerEntry);
        const run1Finished = state.getAgentEntry("build")!.finishedAt!;
        expect(run1Finished.getTime()).toBe(new Date("2026-01-01T00:00:00Z").getTime());

        // Iteration 2 reuses the same agent id — the stale finishedAt must be
        // cleared, otherwise elapsed (finishedAt - createdAt) would go
        // negative since createdAt2 > finishedAt1.
        vi.setSystemTime(new Date("2026-01-01T00:10:00Z"));
        state.update({ id: "build", status: "started", createdAt: new Date() });
        const reStarted = state.getAgentEntry("build")!;
        expect(reStarted.status).toBe("started");
        expect(reStarted.finishedAt).toBeUndefined();

        // Completion re-stamps a fresh finishedAt instead of freezing the
        // previous iteration's stamp.
        state.update({
          id: "build",
          status: "done",
          passed: true,
          summary: "ok",
        } as AgentViewerEntry);
        const reDone = state.getAgentEntry("build")!;
        expect(reDone.finishedAt!.getTime()).toBe(new Date("2026-01-01T00:10:00Z").getTime());
        // Elapsed is non-negative and the stamp is fresh, not frozen.
        expect(reDone.finishedAt!.getTime() - reDone.createdAt.getTime()).toBeGreaterThanOrEqual(0);
        expect(reDone.finishedAt!.getTime()).toBeGreaterThan(run1Finished.getTime());
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ── getAgentEntries ───────────────────────────────────────

  describe("getAgentEntries", () => {
    it("returns a read-only map of all entries", () => {
      state.update({ id: "a", status: "started", createdAt: new Date() });
      state.update({ id: "b", status: "started", createdAt: new Date() });
      const entries = state.getAgentEntries();
      expect(entries.size).toBe(2);
      expect(entries.has("a")).toBe(true);
      expect(entries.has("b")).toBe(true);
    });
  });

  // ── pushStreamEvent ────────────────────────────────────────

  describe("pushStreamEvent", () => {
    it("auto-creates a started entry when agent id is unknown", () => {
      state.pushStreamEvent("new-agent", makeAgentStartEvent(), defaultFormat);
      const entry = state.getAgentEntry("new-agent");
      expect(entry).toBeDefined();
      expect(entry!.status).toBe("started");
    });

    it("updates lastStreamLine for running entries", () => {
      state.update({ id: "builder", status: "running", createdAt: new Date() });
      state.pushStreamEvent("builder", makeAgentStartEvent(), defaultFormat);
      const entry = state.getAgentEntry("builder")!;
      if (entry.status === "running") {
        expect(entry.lastStreamLine).toBe("agent_start: detail");
      }
    });

    it("stores the last formatted stream line", () => {
      state.pushStreamEvent("builder", makeAgentStartEvent(), defaultFormat);
      expect(state.getLastLine("builder")).toBe("agent_start: detail");
    });

    it("lastStreamLine getter returns most recent line across all agents", () => {
      state.pushStreamEvent("a", makeAgentStartEvent(), () => "line a");
      state.pushStreamEvent("b", makeAgentStartEvent(), () => "line b");
      expect(state.lastStreamLine).toBe("line b");
    });

    it("lastStreamLine returns empty string when no events pushed", () => {
      expect(state.lastStreamLine).toBe("");
    });

    it("appends raw events to in-memory buffer", () => {
      state.pushStreamEvent("builder", makeAgentStartEvent(), defaultFormat);
      const events = state.getConversation("builder");
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("agent_start");
    });

    it("caps in-memory events at MAX_AGENT_EVENTS (200)", () => {
      for (let i = 0; i < 250; i++) {
        state.pushStreamEvent("builder", makeAgentStartEvent(), () => `event ${i}`);
      }
      const events = state.getConversation("builder");
      expect(events.length).toBeLessThanOrEqual(200);
    });

    it("returns empty array for unknown agent via getConversation", () => {
      expect(state.getConversation("nonexistent")).toEqual([]);
    });

    it("returns empty array for unknown agent via getConversationMessages", () => {
      expect(state.getConversationMessages("nonexistent")).toEqual([]);
    });
  });

  // ── appendMessageFromEvent (message deduplication) ─────────

  describe("message tracking via pushStreamEvent", () => {
    it("captures message_end messages", () => {
      state.pushStreamEvent("builder", makeMessageEndEvent("Hello world"), defaultFormat);
      const messages = state.getConversationMessages("builder");
      expect(messages.length).toBe(1);
    });

    it("ignores message_update deltas (conversation updates at message_end)", () => {
      state.pushStreamEvent("builder", makeMessageStartEvent(), defaultFormat);
      expect(state.getConversationMessages("builder").length).toBe(1);

      state.pushStreamEvent("builder", makeMessageUpdateEvent("updated text"), defaultFormat);
      const messages = state.getConversationMessages("builder");
      expect(messages.length).toBe(1); // Unchanged — deltas do not mutate the conversation
    });

    it("replaces last message for message_end (dedup after message_start)", () => {
      state.pushStreamEvent("builder", makeMessageStartEvent(), defaultFormat);
      state.pushStreamEvent("builder", makeMessageEndEvent("final text"), defaultFormat);
      const messages = state.getConversationMessages("builder");
      expect(messages.length).toBe(1); // Replaced, not appended
    });

    it("second message_end replaces first (message_end always deduplicates last entry)", () => {
      state.pushStreamEvent("builder", makeMessageEndEvent("first"), defaultFormat);
      state.pushStreamEvent("builder", makeMessageEndEvent("second"), defaultFormat);
      const messages = state.getConversationMessages("builder");
      // message_end replaces the last entry (same dedup as message_update)
      expect(messages.length).toBe(1);
    });
  });

  // ── clearMemory / dispose ──────────────────────────────────

  describe("clearMemory", () => {
    it("clears agent entries but preserves conversation and stream data", () => {
      state.update({ id: "builder", status: "started", createdAt: new Date() });
      state.pushStreamEvent("builder", makeMessageEndEvent("data"), defaultFormat);

      state.clearMemory();

      expect(state.entryCount).toBe(0);
      // Conversations are preserved (clearMemory only clears agents)
      expect(state.getConversationMessages("builder").length).toBe(1);
      expect(state.getConversation("builder").length).toBe(1);
    });
  });

  describe("dispose", () => {
    it("clears all state including conversations", () => {
      state.update({ id: "builder", status: "started", createdAt: new Date() });
      state.pushStreamEvent("builder", makeMessageEndEvent("data"), defaultFormat);

      state.dispose();

      expect(state.entryCount).toBe(0);
      expect(state.getConversationMessages("builder")).toEqual([]);
      expect(state.getConversation("builder")).toEqual([]);
      expect(state.lastStreamLine).toBe("");
    });

    it("clears all internal maps including journals after persistence", () => {
      const tmpDir = makeTempDir();
      try {
        state.setStreamDir(tmpDir);
        state.pushStreamEvent("builder", makeAgentStartEvent(), defaultFormat);
        state.pushStreamEvent(
          "builder",
          {
            type: "tool_execution_start",
            toolCallId: "tc-1",
            toolName: "bash",
            args: { cmd: "ls" },
          },
          defaultFormat,
        );
        state.pushStreamEvent("builder", makeMessageEndEvent("final"), defaultFormat);

        const internal = state as unknown as {
          agents: Map<string, unknown>;
          lastLines: Map<string, unknown>;
          agentEvents: Map<string, unknown>;
          agentMessages: Map<string, unknown>;
          agentTools: Map<string, AgentToolEntry[]>;
          journals: Map<string, unknown>;
          toolStartArgs: Map<string, Map<string, unknown>>;
          streamDir?: string;
        };

        // Journal persistence registered a journal, a tool log entry, and
        // tool args for the agent.
        expect(internal.journals.get("builder")).toBeDefined();
        expect(internal.toolStartArgs.get("builder")?.size).toBe(1);
        expect(internal.agentTools.get("builder")?.length).toBe(1);

        state.dispose();

        expect(internal.agents.size).toBe(0);
        expect(internal.lastLines.size).toBe(0);
        expect(internal.agentEvents.size).toBe(0);
        expect(internal.agentMessages.size).toBe(0);
        expect(internal.agentTools.size).toBe(0);
        expect(internal.journals.size).toBe(0);
        expect(internal.toolStartArgs.size).toBe(0);
        expect(internal.streamDir).toBeUndefined();
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  // ── Filesystem persistence ──────────────────────────────────

  describe("filesystem persistence", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = makeTempDir();
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("persists stream events to the agent journal when streamDir is set", () => {
      state.setStreamDir(tmpDir);
      state.pushStreamEvent("agent-x", makeAgentStartEvent(), defaultFormat);
      state.pushStreamEvent("agent-x", makeMessageEndEvent("Hello"), defaultFormat);

      state.dispose();

      // The journal file exists and its lines parse to journal entries.
      const journalPath = join(tmpDir, "agent-x.journal.jsonl");
      expect(existsSync(journalPath)).toBe(true);
      const entries = readFileSync(journalPath, "utf-8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as AgentJournalEntry);

      // A stream entry carries the formatted line for each persisted event.
      const streamEntries = entries.filter(
        (e): e is Extract<AgentJournalEntry, { type: "stream" }> => e.type === "stream",
      );
      expect(streamEntries).toHaveLength(2);
      expect(streamEntries[0]).toMatchObject({ type: "stream", line: "agent_start: detail" });
      expect(streamEntries[1]).toMatchObject({ type: "stream", line: "message_end: detail" });
    });

    it("excludes turn_start, turn_end, message_update from journal stream entries", () => {
      state.setStreamDir(tmpDir);
      state.pushStreamEvent("agent-x", makeTurnStartEvent(), defaultFormat);
      state.pushStreamEvent("agent-x", makeTurnEndEvent(), defaultFormat);
      state.pushStreamEvent("agent-x", makeMessageUpdateEvent("update text"), defaultFormat);
      state.pushStreamEvent("agent-x", makeAgentStartEvent(), defaultFormat);

      state.dispose();

      const entries = readJournal(tmpDir, "agent-x");
      const streamLines = entries
        .filter((e): e is Extract<AgentJournalEntry, { type: "stream" }> => e.type === "stream")
        .map((e) => e.line);
      expect(streamLines).not.toContain("turn_start: detail");
      expect(streamLines).not.toContain("turn_end: detail");
      expect(streamLines).not.toContain("message_update: detail");
      expect(streamLines).toContain("agent_start: detail");
    });

    it("persists message_end messages to the agent journal", () => {
      state.setStreamDir(tmpDir);
      state.pushStreamEvent("agent-x", makeMessageEndEvent("Hello"), defaultFormat);
      state.pushStreamEvent("agent-x", makeMessageEndEvent("Question", "user"), defaultFormat);
      state.pushStreamEvent(
        "agent-x",
        messageEndEvent(toolResultMessage("tc-1", "bash", [text("tool output")])),
        defaultFormat,
      );
      // Deltas and starts carry no finalized message: NOT persisted (AC 6).
      state.pushStreamEvent("agent-x", makeMessageUpdateEvent("delta"), defaultFormat);
      state.pushStreamEvent("agent-x", makeMessageStartEvent(), defaultFormat);

      state.dispose();

      const entries = readJournal(tmpDir, "agent-x");
      const messageEntries = entries.filter(
        (e): e is Extract<AgentJournalEntry, { type: "message" }> => e.type === "message",
      );
      // Exactly the three message_end entries — update/start added none.
      expect(messageEntries).toHaveLength(3);
      expect(messageEntries[0]).toMatchObject({
        type: "message",
        message: { role: "assistant", content: [{ type: "text", text: "Hello" }] },
      });
      expect(messageEntries[1]).toMatchObject({ type: "message", message: { role: "user" } });
      expect(messageEntries[2]).toMatchObject({
        type: "message",
        message: { role: "toolResult", toolCallId: "tc-1", toolName: "bash" },
      });
    });

    it("persists tool entries, merging args from the start into the end", () => {
      state.setStreamDir(tmpDir);
      state.pushStreamEvent(
        "agent-x",
        {
          type: "tool_execution_start",
          toolCallId: "tc-1",
          toolName: "bash",
          args: { cmd: "ls" },
        },
        defaultFormat,
      );
      state.pushStreamEvent(
        "agent-x",
        {
          type: "tool_execution_end",
          toolCallId: "tc-1",
          toolName: "bash",
          result: "file listing",
          isError: false,
        },
        defaultFormat,
      );

      // The remembered start args are pruned once the end entry consumed
      // them (bounded memory: one slot per in-flight tool call).
      const internal = state as unknown as { toolStartArgs: Map<string, Map<string, unknown>> };
      expect(internal.toolStartArgs.get("agent-x")?.size).toBe(0);

      state.dispose();

      const entries = readJournal(tmpDir, "agent-x");
      const toolEntries = entries.filter(
        (e): e is Extract<AgentJournalEntry, { type: "tool" }> => e.type === "tool",
      );
      expect(toolEntries).toHaveLength(2);
      expect(toolEntries[0]).toMatchObject({
        type: "tool",
        toolCallId: "tc-1",
        toolName: "bash",
        args: { cmd: "ls" },
      });
      expect(toolEntries[0].result).toBeUndefined();
      expect(toolEntries[1]).toMatchObject({
        type: "tool",
        toolCallId: "tc-1",
        toolName: "bash",
        result: "file listing",
        isError: false,
        // args are replayed from the start event.
        args: { cmd: "ls" },
      });
    });

    it("appendLifecycle writes a lifecycle entry when streamDir is set", () => {
      state.setStreamDir(tmpDir);
      state.appendLifecycle("agent-x", "done", true, "Build passed");

      const entries = readJournal(tmpDir, "agent-x");
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        type: "lifecycle",
        phase: "done",
        passed: true,
        summary: "Build passed",
      });
      expect(entries[0].ts).toBeTypeOf("string");
    });

    it("appendLifecycle is a no-op without streamDir", () => {
      state.appendLifecycle("agent-x", "error", false, "boom");

      const files = readdirSync(tmpDir);
      expect(files.some((f) => f.endsWith(".journal.jsonl"))).toBe(false);
    });

    it("does not throw when the stream directory is a regular file", () => {
      const blocker = join(tmpDir, "blocker");
      writeFileSync(blocker, "a regular file, not a directory", "utf-8");
      state.setStreamDir(blocker);

      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      try {
        expect(() =>
          state.pushStreamEvent("agent-x", makeAgentStartEvent(), defaultFormat),
        ).not.toThrow();
        expect(warnSpy).toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("applies constructor journalRetention to journal rotation (threaded, not config-read)", () => {
      // Retention is threaded through AgentViewerStateOptions: a state
      // constructed without options falls back to the canonical defaults
      // (10MB/5), so six ~128-byte entries never rotate...
      state.setStreamDir(tmpDir);
      for (let i = 0; i < 6; i++) {
        const line = `line-${String(i).padStart(2, "0")}-${"x".repeat(60)}`;
        state.pushStreamEvent("default-agent", makeAgentStartEvent(), () => line);
      }
      const defaultBase = join(tmpDir, "default-agent.journal.jsonl");
      expect(existsSync(defaultBase)).toBe(true);
      expect(existsSync(`${defaultBase}.1`)).toBe(false);

      // ...while an explicitly retained state honors the threaded 200-byte
      // maxBytes: the same event volume rotates into numeric segments
      // (mirrors AgentJournal's rotation tests with explicit options).
      const retained = new AgentViewerState({
        journalRetention: { maxBytes: 200, maxFiles: 3 },
      });
      retained.setStreamDir(tmpDir);
      for (let i = 0; i < 6; i++) {
        const line = `line-${String(i).padStart(2, "0")}-${"x".repeat(60)}`;
        retained.pushStreamEvent("rot-agent", makeAgentStartEvent(), () => line);
      }
      retained.dispose();

      const base = join(tmpDir, "rot-agent.journal.jsonl");
      expect(existsSync(base)).toBe(true);
      expect(existsSync(`${base}.1`)).toBe(true);
      expect(existsSync(`${base}.2`)).toBe(true);
    });

    // ── journaling gate ──────────────────────────────────────

    describe("journaling gate", () => {
      it("a display-mode state (journaling=false) never writes yet keeps live caches updating", () => {
        state.setStreamDir(tmpDir);
        state.setJournaling(false);

        state.pushStreamEvent("agent-x", makeAgentStartEvent(), defaultFormat);
        state.appendLifecycle("agent-x", "done", true, "must not hit disk");

        // In-memory display caches still update...
        expect(state.getLastLine("agent-x")).toBe("agent_start: detail");
        expect(state.getConversation("agent-x")).toHaveLength(1);

        // ...but no journal file was created (single-writer proof: the
        // journal recorder owns disk writes in display mode).
        const files = readdirSync(tmpDir).filter((f) => f.endsWith(".journal.jsonl"));
        expect(files).toEqual([]);
      });

      it("journaling=false keeps replay reads working from a pre-existing journal", async () => {
        writeFileSync(
          join(tmpDir, "agent-x.journal.jsonl"),
          JSON.stringify({ type: "lifecycle", phase: "started", ts: "2026-01-01T00:00:00.000Z" }) +
            "\n" +
            JSON.stringify({
              type: "lifecycle",
              phase: "done",
              passed: true,
              summary: "ran",
              ts: "2026-01-01T00:05:00.000Z",
            }) +
            "\n",
          "utf-8",
        );

        state.setStreamDir(tmpDir);
        state.setJournaling(false);
        await state.prepopulateStreamFiles(tmpDir);

        const entry = state.getAgentEntry("agent-x");
        expect(entry?.status).toBe("done");
        if (entry?.status === "done") {
          expect(entry.passed).toBe(true);
        }

        // Reads never append: the pre-existing journal is byte-identical.
        expect(readJournal(tmpDir, "agent-x")).toHaveLength(2);
      });

      it("re-enabling journaling resumes disk writes on the same state", () => {
        state.setStreamDir(tmpDir);
        state.setJournaling(false);
        state.appendLifecycle("agent-x", "started");
        expect(readJournal(tmpDir, "agent-x")).toEqual([]);

        state.setJournaling(true);
        state.appendLifecycle("agent-x", "done", true, "now writing again");
        const entries = readJournal(tmpDir, "agent-x");
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
          type: "lifecycle",
          phase: "done",
          passed: true,
          summary: "now writing again",
        });
      });

      it("legacy migration during replay stays ungated by journaling=false", async () => {
        // A display-only state still folds legacy files into journals on
        // prepopulate (display replay must fold legacy agents) - the one
        // deliberate write exception to the journaling gate.
        writeFileSync(join(tmpDir, "agent-x.stream"), "tool_execution_start: read\n", "utf-8");

        state.setStreamDir(tmpDir);
        state.setJournaling(false);
        await state.prepopulateStreamFiles(tmpDir);

        // The legacy file was folded into a journal (migration write) and
        // the replay derived an entry from it.
        expect(existsSync(join(tmpDir, "agent-x.journal.jsonl"))).toBe(true);
        expect(state.getAgentEntry("agent-x")).toBeDefined();
      });
    });

    // ── prepopulateStreamFiles: journal replay ──────────────

    it("replays a completed run from the journal", async () => {
      const started = "2026-01-01T00:00:00.000Z";
      const done = "2026-01-01T00:05:00.000Z";
      writeFileSync(
        join(tmpDir, "replay-ok.journal.jsonl"),
        [
          JSON.stringify({ type: "lifecycle", phase: "started", ts: started }),
          JSON.stringify({
            type: "stream",
            line: "agent_start: detail",
            ts: "2026-01-01T00:00:01.000Z",
          }),
          JSON.stringify({
            type: "message",
            message: { role: "assistant", content: [{ type: "text", text: "Hello" }] },
            ts: "2026-01-01T00:04:00.000Z",
          }),
          // forge entries carry future loop/workspace/session context —
          // replay tolerates and skips them.
          JSON.stringify({
            type: "forge",
            phase: "loop-round",
            details: { round: 1 },
            ts: "2026-01-01T00:04:30.000Z",
          }),
          JSON.stringify({
            type: "lifecycle",
            phase: "done",
            passed: true,
            summary: "ok",
            ts: done,
          }),
        ].join("\n") + "\n",
        "utf-8",
      );

      await state.prepopulateStreamFiles(tmpDir);

      // Terminal lifecycle: done + passed + summary + finishedAt from the
      // done entry's ts; createdAt from the started entry's ts.
      const entry = state.getAgentEntry("replay-ok")!;
      expect(entry.status).toBe("done");
      if (entry.status === "done") {
        expect(entry.passed).toBe(true);
        expect(entry.summary).toBe("ok");
      }
      expect(entry.finishedAt!.getTime()).toBe(new Date(done).getTime());
      expect(entry.createdAt.getTime()).toBe(new Date(started).getTime());

      // message entries populate the message cache; stream lines the
      // last-line cache (last wins).
      const messages = state.getConversationMessages("replay-ok");
      expect(messages.length).toBe(1);
      expect(AgentDisplayHelpers.extractMessageText(messages[0])).toBe("Hello");
      expect(state.getLastLine("replay-ok")).toBe("agent_start: detail");
    });

    it("replays a segmented journal (base + rotated segments) as one run", async () => {
      const started = "2026-01-01T00:00:00.000Z";
      const done = "2026-01-01T00:05:00.000Z";
      // The base file is segment 0 (OLDEST); rotated segments hold newer
      // entries. Discovery must map both to the same agent id and replay
      // must concatenate 0 → N so the done terminal in the .1 segment wins.
      writeFileSync(
        join(tmpDir, "seg-agent.journal.jsonl"),
        [
          JSON.stringify({ type: "lifecycle", phase: "started", ts: started }),
          JSON.stringify({
            type: "stream",
            line: "early stream line",
            ts: "2026-01-01T00:00:01.000Z",
          }),
        ].join("\n") + "\n",
        "utf-8",
      );
      writeFileSync(
        join(tmpDir, "seg-agent.journal.jsonl.1"),
        [
          JSON.stringify({
            type: "stream",
            line: "late stream line",
            ts: "2026-01-01T00:04:00.000Z",
          }),
          JSON.stringify({
            type: "lifecycle",
            phase: "done",
            passed: true,
            summary: "ok across segments",
            ts: done,
          }),
        ].join("\n") + "\n",
        "utf-8",
      );

      await state.prepopulateStreamFiles(tmpDir);

      // One agent entry, built from both segments: createdAt from the base
      // started entry, status/passed/summary/finishedAt from the .1 done
      // entry (last-lifecycle-wins across the concat), last stream line
      // from the newest segment.
      const entry = state.getAgentEntry("seg-agent")!;
      expect(entry.status).toBe("done");
      if (entry.status === "done") {
        expect(entry.passed).toBe(true);
        expect(entry.summary).toBe("ok across segments");
      }
      expect(entry.createdAt.getTime()).toBe(new Date(started).getTime());
      expect(entry.finishedAt!.getTime()).toBe(new Date(done).getTime());
      expect(state.getLastLine("seg-agent")).toBe("late stream line");
    });

    it("replays a failed run as passed=false (renders ✗ failed)", async () => {
      writeFileSync(
        join(tmpDir, "replay-fail.journal.jsonl"),
        JSON.stringify({
          type: "lifecycle",
          phase: "done",
          passed: false,
          summary: "build failed",
          ts: "2026-01-01T00:05:00.000Z",
        }) + "\n",
        "utf-8",
      );

      await state.prepopulateStreamFiles(tmpDir);

      const entry = state.getAgentEntry("replay-fail")!;
      expect(entry.status).toBe("done");
      expect(AgentDisplayHelpers.getEntryPassed(entry)).toBe(false);
      expect(AgentDisplayHelpers.getStatusLabel("done", false).label).toBe("failed");
      expect(entry.finishedAt).toBeInstanceOf(Date);
      expect(entry.summary).toBe("build failed");
    });

    it("replays an interrupted run as running without finishedAt (never 'failed')", async () => {
      // Only the started lifecycle was persisted before the process died —
      // the replayed entry must stay in-flight, not fabricate a failure.
      writeFileSync(
        join(tmpDir, "replay-run.journal.jsonl"),
        JSON.stringify({ type: "lifecycle", phase: "started", ts: "2026-01-01T00:00:00.000Z" }) +
          "\n",
        "utf-8",
      );

      await state.prepopulateStreamFiles(tmpDir);

      const entry = state.getAgentEntry("replay-run")!;
      expect(entry.status).toBe("running");
      expect(entry.finishedAt).toBeUndefined();
      expect(AgentDisplayHelpers.getEntryPassed(entry)).toBeUndefined();
    });

    it("replays error and cancelled terminal lifecycles truthfully", async () => {
      writeFileSync(
        join(tmpDir, "replay-err.journal.jsonl"),
        JSON.stringify({
          type: "lifecycle",
          phase: "error",
          summary: "agent blew up",
          ts: "2026-01-01T00:05:00.000Z",
        }) + "\n",
        "utf-8",
      );
      writeFileSync(
        join(tmpDir, "replay-cancel.journal.jsonl"),
        JSON.stringify({
          type: "lifecycle",
          phase: "cancelled",
          summary: "user cancelled",
          ts: "2026-01-01T00:03:00.000Z",
        }) + "\n",
        "utf-8",
      );

      await state.prepopulateStreamFiles(tmpDir);

      const errored = state.getAgentEntry("replay-err")!;
      expect(errored.status).toBe("error");
      expect(errored.finishedAt).toBeInstanceOf(Date);
      expect(errored.finishedAt!.getTime()).toBe(new Date("2026-01-01T00:05:00.000Z").getTime());

      const cancelled = state.getAgentEntry("replay-cancel")!;
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.summary).toBe("user cancelled");
      // update() treats cancelled as non-terminal for stamping (loop re-runs
      // must never inherit a stale finishedAt), so the replayed stamp is
      // cleared — the status and summary still replay truthfully.
      expect(cancelled.finishedAt).toBeUndefined();
    });

    it("replays started → done → started as in-flight (last lifecycle wins)", async () => {
      // Run 1 completed; run 2 of the same agent id started afterwards and
      // is still in flight. The trailing started must not be relabeled by
      // run 1's terminal — the correct reduction is last-lifecycle-wins.
      writeFileSync(
        join(tmpDir, "rerun-agent.journal.jsonl"),
        [
          JSON.stringify({
            type: "lifecycle",
            phase: "started",
            ts: "2026-01-01T00:00:00.000Z",
          }),
          JSON.stringify({
            type: "lifecycle",
            phase: "done",
            passed: true,
            summary: "run 1 ok",
            ts: "2026-01-01T00:05:00.000Z",
          }),
          JSON.stringify({
            type: "lifecycle",
            phase: "started",
            ts: "2026-01-01T00:10:00.000Z",
          }),
        ].join("\n") + "\n",
        "utf-8",
      );

      await state.prepopulateStreamFiles(tmpDir);

      const entry = state.getAgentEntry("rerun-agent")!;
      expect(entry.status).toBe("running");
      expect(entry.finishedAt).toBeUndefined();
      expect(AgentDisplayHelpers.getEntryPassed(entry)).toBeUndefined();
    });

    it("replay does not overwrite a live-seeded entry (no-overwrite guard)", async () => {
      // The journal holds a terminal from a PRIOR run of the same agent id.
      writeFileSync(
        join(tmpDir, "builder.journal.jsonl"),
        JSON.stringify({
          type: "lifecycle",
          phase: "done",
          passed: true,
          summary: "old run",
          ts: "2026-01-01T00:05:00.000Z",
        }) + "\n",
        "utf-8",
      );
      // connect() seeds the live entry synchronously before prepopulate
      // resolves (agentQuery seeding).
      state.update({ id: "builder", status: "started", createdAt: new Date() });

      await state.prepopulateStreamFiles(tmpDir);

      // Live truth wins — the stale terminal must not relabel a running agent.
      const entry = state.getAgentEntry("builder")!;
      expect(entry.status).toBe("started");
      expect(entry.finishedAt).toBeUndefined();
      expect(AgentDisplayHelpers.getEntryPassed(entry)).toBeUndefined();
    });

    it("replay still populates caches for an agent with a live entry", async () => {
      writeFileSync(
        join(tmpDir, "builder.journal.jsonl"),
        JSON.stringify({
          type: "stream",
          line: "agent_start: detail",
          ts: "2026-01-01T00:00:01.000Z",
        }) +
          "\n" +
          JSON.stringify({
            type: "message",
            message: { role: "assistant", content: [{ type: "text", text: "Hello" }] },
            ts: "2026-01-01T00:00:02.000Z",
          }) +
          "\n",
        "utf-8",
      );
      state.update({ id: "builder", status: "running", createdAt: new Date() });

      await state.prepopulateStreamFiles(tmpDir);

      // The entry is untouched but the derived caches are still replayed.
      expect(state.getAgentEntry("builder")!.status).toBe("running");
      expect(state.getLastLine("builder")).toBe("agent_start: detail");
      expect(state.getConversationMessages("builder").length).toBe(1);
    });

    it("uses the earliest entry ts as createdAt when no started lifecycle exists (migrated journal)", async () => {
      // A migrated legacy journal carries no lifecycle entries — createdAt
      // must come from the earliest valid entry ts, not the file birthtime.
      const firstTs = "2026-01-01T00:00:01.000Z";
      writeFileSync(
        join(tmpDir, "migrated-agent.journal.jsonl"),
        [
          JSON.stringify({ type: "stream", line: "agent_start: detail", ts: firstTs }),
          JSON.stringify({
            type: "message",
            message: { role: "assistant" },
            ts: "2026-01-01T00:00:03.000Z",
          }),
          JSON.stringify({
            type: "stream",
            line: "tool_execution_start: read",
            ts: "2026-01-01T00:00:05.000Z",
          }),
        ].join("\n") + "\n",
        "utf-8",
      );

      await state.prepopulateStreamFiles(tmpDir);

      const entry = state.getAgentEntry("migrated-agent")!;
      expect(entry.status).toBe("running");
      expect(entry.createdAt.getTime()).toBe(new Date(firstTs).getTime());
    });

    it("falls back to the journal birthtime when no started lifecycle and no entry ts parses", async () => {
      // Neither a started lifecycle nor a parseable entry ts exists —
      // createdAt falls back to the journal file's birthtime.
      writeFileSync(
        join(tmpDir, "no-lifecycle.journal.jsonl"),
        JSON.stringify({ type: "stream", line: "agent_start: detail", ts: "not-a-date" }) + "\n",
        "utf-8",
      );

      await state.prepopulateStreamFiles(tmpDir);

      const entry = state.getAgentEntry("no-lifecycle")!;
      expect(entry.status).toBe("running");
      expect(entry.createdAt).toBeInstanceOf(Date);
      const birthtime = statSync(join(tmpDir, "no-lifecycle.journal.jsonl")).birthtime;
      // The fallback stamp is the file birthtime (or "now" on filesystems
      // that report no birthtime — epoch 0 is treated as absent).
      expect(entry.createdAt.getTime()).toBeGreaterThanOrEqual(
        birthtime.getTime() > 0 ? birthtime.getTime() : 0,
      );
    });

    it("skips invalid lifecycle timestamps on replay (never NaN dates)", async () => {
      // A corrupted started stamp must not poison createdAt — replay skips
      // it and resolves createdAt from the earliest valid entry ts.
      writeFileSync(
        join(tmpDir, "bad-ts.journal.jsonl"),
        [
          JSON.stringify({ type: "lifecycle", phase: "started", ts: "not-a-date" }),
          JSON.stringify({
            type: "lifecycle",
            phase: "done",
            passed: true,
            summary: "ok",
            ts: "2026-01-01T00:05:00.000Z",
          }),
        ].join("\n") + "\n",
        "utf-8",
      );

      await state.prepopulateStreamFiles(tmpDir);

      const entry = state.getAgentEntry("bad-ts")!;
      expect(entry.status).toBe("done");
      expect(Number.isNaN(entry.createdAt.getTime())).toBe(false);
      expect(entry.createdAt.getTime()).toBe(new Date("2026-01-01T00:05:00.000Z").getTime());
      expect(entry.finishedAt!.getTime()).toBe(new Date("2026-01-01T00:05:00.000Z").getTime());
    });

    it("skips an invalid terminal ts (never a NaN finishedAt)", async () => {
      // A corrupted terminal stamp must not poison finishedAt — the
      // terminal status/passed/summary are kept, the stamp is dropped and
      // update()'s fallback writes a valid fresh stamp instead.
      writeFileSync(
        join(tmpDir, "bad-terminal-ts.journal.jsonl"),
        [
          JSON.stringify({ type: "lifecycle", phase: "started", ts: "2026-01-01T00:00:00.000Z" }),
          JSON.stringify({
            type: "lifecycle",
            phase: "done",
            passed: true,
            summary: "ok",
            ts: "garbage",
          }),
        ].join("\n") + "\n",
        "utf-8",
      );

      await state.prepopulateStreamFiles(tmpDir);

      const entry = state.getAgentEntry("bad-terminal-ts")!;
      expect(entry.status).toBe("done");
      expect(AgentDisplayHelpers.getEntryPassed(entry)).toBe(true);
      expect(entry.finishedAt).toBeDefined();
      expect(Number.isNaN(entry.finishedAt!.getTime())).toBe(false);
      expect(entry.createdAt.getTime()).toBe(new Date("2026-01-01T00:00:00.000Z").getTime());
    });

    it("logs a warn and returns cleanly when the stream directory cannot be scanned", async () => {
      const blocker = join(tmpDir, "blocker-file");
      writeFileSync(blocker, "a regular file, not a directory", "utf-8");
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      try {
        await state.prepopulateStreamFiles(blocker);

        expect(state.entryCount).toBe(0);
        expect(warnSpy).toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("setStreamDir with a new directory re-targets journal appends", () => {
      const dir1 = makeTempDir();
      const dir2 = makeTempDir();
      try {
        state.setStreamDir(dir1);
        state.pushStreamEvent("agent-x", makeAgentStartEvent(), defaultFormat);

        // Switching directories must not keep appending to dir1's journal.
        state.setStreamDir(dir2);
        state.pushStreamEvent("agent-x", makeMessageEndEvent("in dir2"), defaultFormat);

        const streamLines = (entries: AgentJournalEntry[]): string[] =>
          entries
            .filter((e): e is Extract<AgentJournalEntry, { type: "stream" }> => e.type === "stream")
            .map((e) => e.line);

        expect(streamLines(readJournal(dir1, "agent-x"))).toEqual(["agent_start: detail"]);
        expect(streamLines(readJournal(dir2, "agent-x"))).toEqual(["message_end: detail"]);
      } finally {
        rmSync(dir1, { recursive: true, force: true });
        rmSync(dir2, { recursive: true, force: true });
      }
    });

    it("migrates legacy files into a journal on prepopulate", async () => {
      // Legacy pre-journal layout: .stream, .messages.jsonl and BOTH the
      // current .events.jsonl plus a rotated .events.1.jsonl archive.
      writeFileSync(join(tmpDir, "legacy-agent.stream"), "tool_execution_start: read\n", "utf-8");
      writeFileSync(
        join(tmpDir, "legacy-agent.messages.jsonl"),
        JSON.stringify({ role: "assistant", content: [{ type: "text", text: "prior" }] }) + "\n",
        "utf-8",
      );
      writeFileSync(
        join(tmpDir, "legacy-agent.events.jsonl"),
        JSON.stringify({ type: "agent_start" }) + "\n",
        "utf-8",
      );
      writeFileSync(
        join(tmpDir, "legacy-agent.events.1.jsonl"),
        JSON.stringify({ type: "turn_start" }) + "\n",
        "utf-8",
      );

      await state.prepopulateStreamFiles(tmpDir);

      // The journal now exists and every legacy file was folded in + removed.
      expect(existsSync(join(tmpDir, "legacy-agent.journal.jsonl"))).toBe(true);
      expect(existsSync(join(tmpDir, "legacy-agent.stream"))).toBe(false);
      expect(existsSync(join(tmpDir, "legacy-agent.messages.jsonl"))).toBe(false);
      expect(existsSync(join(tmpDir, "legacy-agent.events.jsonl"))).toBe(false);
      expect(existsSync(join(tmpDir, "legacy-agent.events.1.jsonl"))).toBe(false);

      // Legacy files carry no lifecycle, so the migrated entry is "running"
      // (the truthful state — no terminal marker was ever recorded), with
      // its messages and last stream line loaded. createdAt comes from the
      // earliest entry ts (the legacy file mtimes), never invented.
      const entry = state.getAgentEntry("legacy-agent")!;
      expect(entry.status).toBe("running");
      expect(entry.finishedAt).toBeUndefined();
      expect(entry.createdAt).toBeInstanceOf(Date);
      expect(entry.createdAt.getTime()).toBeGreaterThan(0);
      expect(state.getConversationMessages("legacy-agent").length).toBe(1);
      expect(state.getLastLine("legacy-agent")).toBe("tool_execution_start: read");
    });

    it("legacy migration folds honor the state journalRetention (migration creation site)", async () => {
      // prepopulate's legacy fold creates its journal through the same
      // journalRetention field as live journalFor writes: a retained state
      // folds oversized legacy content into rotated segments...
      const retainedDir = makeTempDir();
      const defaultDir = makeTempDir();
      try {
        const line = "x".repeat(80);
        // Six ~140-byte stream entries (~830 bytes total).
        const content = `${line}\n${line}\n${line}\n${line}\n${line}\n${line}\n`;
        writeFileSync(join(retainedDir, "mig-agent.stream"), content, "utf-8");
        writeFileSync(join(defaultDir, "mig-agent.stream"), content, "utf-8");

        const segments = (dir: string): string[] =>
          readdirSync(dir).filter((name) => /^mig-agent\.journal\.jsonl\.\d+$/.test(name));

        const retained = new AgentViewerState({
          journalRetention: { maxBytes: 200, maxFiles: 3 },
        });
        await retained.prepopulateStreamFiles(retainedDir);
        retained.dispose();

        // The threaded 200-byte cap rotated the fold into numeric segments.
        expect(existsSync(join(retainedDir, "mig-agent.journal.jsonl"))).toBe(true);
        expect(segments(retainedDir).length).toBeGreaterThan(0);
        expect(existsSync(join(retainedDir, "mig-agent.stream"))).toBe(false);

        // ...while a state without options (canonical 10MB cap) folds the
        // same content into a single base journal with no segments.
        await state.prepopulateStreamFiles(defaultDir);
        expect(existsSync(join(defaultDir, "mig-agent.journal.jsonl"))).toBe(true);
        expect(segments(defaultDir)).toEqual([]);
        expect(existsSync(join(defaultDir, "mig-agent.stream"))).toBe(false);
      } finally {
        rmSync(retainedDir, { recursive: true, force: true });
        rmSync(defaultDir, { recursive: true, force: true });
      }
    });

    it("journal wins over legacy siblings — legacy files are left untouched", async () => {
      // Partial-migration state: both the journal and legacy siblings exist
      // for the same agent. The journal is authoritative — replay builds the
      // entry from it, and the legacy files are NOT folded in or removed.
      writeFileSync(
        join(tmpDir, "coexist-agent.journal.jsonl"),
        JSON.stringify({
          type: "lifecycle",
          phase: "done",
          passed: true,
          summary: "journal run ok",
          ts: "2026-01-01T00:05:00.000Z",
        }) + "\n",
        "utf-8",
      );
      writeFileSync(join(tmpDir, "coexist-agent.stream"), "legacy stream line\n", "utf-8");
      writeFileSync(
        join(tmpDir, "coexist-agent.messages.jsonl"),
        JSON.stringify({ role: "assistant", content: [{ type: "text", text: "legacy msg" }] }) +
          "\n",
        "utf-8",
      );
      writeFileSync(
        join(tmpDir, "coexist-agent.events.jsonl"),
        JSON.stringify({ type: "agent_start" }) + "\n",
        "utf-8",
      );

      await state.prepopulateStreamFiles(tmpDir);

      // The entry is built from the journal's done lifecycle, not the legacy
      // files (which carry no lifecycle at all).
      const entry = state.getAgentEntry("coexist-agent")!;
      expect(entry.status).toBe("done");
      expect(AgentDisplayHelpers.getEntryPassed(entry)).toBe(true);
      expect(entry.summary).toBe("journal run ok");
      expect(entry.finishedAt!.getTime()).toBe(new Date("2026-01-01T00:05:00.000Z").getTime());

      // Legacy siblings are left in place — a journal existing means migration
      // already happened (or never needed to), so they are ignored rather than
      // re-folded (and thus never deleted).
      expect(existsSync(join(tmpDir, "coexist-agent.stream"))).toBe(true);
      expect(existsSync(join(tmpDir, "coexist-agent.messages.jsonl"))).toBe(true);
      expect(existsSync(join(tmpDir, "coexist-agent.events.jsonl"))).toBe(true);
    });

    it("replays a journal with a corrupted trailing line from the valid prefix (AC 7)", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      try {
        writeFileSync(
          join(tmpDir, "corrupt-agent.journal.jsonl"),
          JSON.stringify({
            type: "lifecycle",
            phase: "done",
            passed: true,
            summary: "ok",
            ts: "2026-01-01T00:05:00.000Z",
          }) +
            "\n" +
            '{"type": "lifecycle", "phase": "done", "pass' +
            "\n",
          "utf-8",
        );

        await state.prepopulateStreamFiles(tmpDir);

        // The corrupt tail is skipped with a warn; the valid prefix still
        // builds the entry.
        expect(warnSpy).toHaveBeenCalled();
        const entry = state.getAgentEntry("corrupt-agent")!;
        expect(entry.status).toBe("done");
        expect(AgentDisplayHelpers.getEntryPassed(entry)).toBe(true);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("prepopulate replay is read-only — the journal bytes are unchanged", async () => {
      const journalPath = join(tmpDir, "readonly-agent.journal.jsonl");
      const content =
        JSON.stringify({ type: "lifecycle", phase: "started", ts: "2026-01-01T00:00:00.000Z" }) +
        "\n" +
        JSON.stringify({
          type: "stream",
          line: "agent_start: detail",
          ts: "2026-01-01T00:00:01.000Z",
        }) +
        "\n";
      writeFileSync(journalPath, content, "utf-8");
      const before = readFileSync(journalPath, "utf-8");

      await state.prepopulateStreamFiles(tmpDir);

      // Replay reads the journal, it never appends to it.
      expect(readFileSync(journalPath, "utf-8")).toBe(before);
    });

    it("handles an empty stream directory without entries or throws", async () => {
      await state.prepopulateStreamFiles(tmpDir);

      expect(state.entryCount).toBe(0);
      expect(state.getAgentIds()).toEqual([]);
    });

    it("loadConversationEvents serves only the in-memory sliding window", async () => {
      state.setStreamDir(tmpDir);

      // Raw events are no longer persisted: a legacy .events.jsonl on disk
      // must NOT feed loadConversationEvents.
      writeFileSync(
        join(tmpDir, "agent-x.events.jsonl"),
        JSON.stringify({ type: "agent_start" }) + "\n",
        "utf-8",
      );

      state.pushStreamEvent("agent-x", makeMessageEndEvent("latest"), defaultFormat);

      await state.prepopulateStreamFiles(tmpDir);

      const events = await state.loadConversationEvents("agent-x", 10);
      // Only the in-memory event is served — the disk file never loads.
      expect(events.length).toBe(1);
      expect(events[0].type).toBe("message_end");
    });

    it("loadConversationEvents respects the count parameter (most recent wins)", async () => {
      for (let i = 0; i < 5; i++) {
        state.pushStreamEvent("agent-x", makeAgentStartEvent(), defaultFormat);
      }

      const events = await state.loadConversationEvents("agent-x", 3);
      expect(events.length).toBe(3);
    });
  });

  // ── message_update handling ───────────────────────────────

  describe("message_update handling", () => {
    it("ignores message_update deltas; final text arrives at message_end", () => {
      state.pushStreamEvent("builder", makeMessageStartEvent(), defaultFormat);
      state.pushStreamEvent("builder", makeMessageUpdateEvent("partial"), defaultFormat);

      const during = state.getConversationMessages("builder");
      const duringContent = (during[0] as { content: Array<{ type: string; text: string }> })
        .content;
      expect(duringContent).toEqual([]);

      state.pushStreamEvent("builder", makeMessageEndEvent("final text"), defaultFormat);
      const after = state.getConversationMessages("builder");
      const afterContent = (after[0] as { content: Array<{ type: string; text: string }> }).content;
      expect(afterContent[0].text).toBe("final text");
    });

    it("does not touch the status line or version", () => {
      state.pushStreamEvent("builder", makeMessageStartEvent(), defaultFormat);
      const versionBefore = state.getVersion();

      state.pushStreamEvent("builder", makeMessageUpdateEvent("partial"), defaultFormat);

      expect(state.lastStreamLine).toBe("message_start: detail");
      expect(state.getVersion()).toBe(versionBefore);
      // Raw events are still recorded for diagnostics.
      expect(state.getConversation("builder")).toHaveLength(2);
    });
  });

  // ── loadStreamFile / loadMessagesFile ────────────────────

  describe("loadStreamFile", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = makeTempDir();
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("returns stream lines from the journal", async () => {
      writeFileSync(
        join(tmpDir, "agent-x.journal.jsonl"),
        JSON.stringify({
          type: "stream",
          line: "agent_start: detail",
          ts: "2026-01-01T00:00:01.000Z",
        }) +
          "\n" +
          JSON.stringify({
            type: "stream",
            line: "message_end: detail",
            ts: "2026-01-01T00:00:02.000Z",
          }) +
          "\n",
        "utf-8",
      );
      await state.prepopulateStreamFiles(tmpDir);

      const lines = await state.loadStreamFile("agent-x");
      expect(lines).toEqual(["agent_start: detail", "message_end: detail"]);
    });

    it("loads stream lines from a migrated legacy .stream file", async () => {
      // Pre-write a legacy .stream file; prepopulate folds it into the
      // journal, which loadStreamFile replays.
      writeFileSync(
        join(tmpDir, "agent-x.stream"),
        "agent_start: detail\nmessage_end: detail\n",
        "utf-8",
      );
      await state.prepopulateStreamFiles(tmpDir);

      const lines = await state.loadStreamFile("agent-x");
      expect(lines).toEqual(["agent_start: detail", "message_end: detail"]);
    });

    it("returns empty array when no stream file registered", async () => {
      const lines = await state.loadStreamFile("nonexistent");
      expect(lines).toEqual([]);
    });

    it("returns empty array when streamDir not set", async () => {
      state.pushStreamEvent("agent-x", makeAgentStartEvent(), defaultFormat);
      // streamDir was never set, so no file was persisted
      const lines = await state.loadStreamFile("agent-x");
      expect(lines).toEqual([]);
    });
  });

  describe("loadMessagesFile", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = makeTempDir();
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("returns messages from the journal", async () => {
      writeFileSync(
        join(tmpDir, "agent-x.journal.jsonl"),
        JSON.stringify({
          type: "message",
          message: { role: "assistant", content: [{ type: "text", text: "Hello world" }] },
          ts: "2026-01-01T00:00:01.000Z",
        }) + "\n",
        "utf-8",
      );
      await state.prepopulateStreamFiles(tmpDir);

      const messages = await state.loadMessagesFile("agent-x");
      expect(messages.length).toBe(1);
      expect(AgentDisplayHelpers.extractMessageText(messages[0])).toBe("Hello world");
    });

    it("loads messages from a migrated legacy .messages.jsonl file", async () => {
      writeFileSync(
        join(tmpDir, "agent-x.messages.jsonl"),
        `${JSON.stringify(assistantMessage([text("Hello world")]))}\n`,
        "utf-8",
      );
      await state.prepopulateStreamFiles(tmpDir);

      const messages = await state.loadMessagesFile("agent-x");
      expect(messages.length).toBe(1);
      const msg = messages[0] as { content?: unknown };
      const content = msg.content;
      if (Array.isArray(content)) {
        expect((content[0] as { text: string }).text).toBe("Hello world");
      }
    });

    it("returns empty array when no messages file registered", async () => {
      const messages = await state.loadMessagesFile("nonexistent");
      expect(messages).toEqual([]);
    });
  });

  // ── Message cache via prepopulate (journal replay) ───────

  describe("message cache via prepopulate", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = makeTempDir();
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("loads messages from disk into agentMessages cache", async () => {
      const msgPath = join(tmpDir, "cached-agent.messages.jsonl");
      writeFileSync(
        msgPath,
        JSON.stringify({ role: "assistant", content: [{ type: "text", text: "cached msg" }] }) +
          "\n" +
          JSON.stringify({ role: "user", content: [{ type: "text", text: "user msg" }] }) +
          "\n",
        "utf-8",
      );

      await state.prepopulateStreamFiles(tmpDir);

      const messages = state.getConversationMessages("cached-agent");
      expect(messages.length).toBe(2);
    });

    it("skips malformed JSON lines gracefully", async () => {
      const msgPath = join(tmpDir, "partial-agent.messages.jsonl");
      writeFileSync(
        msgPath,
        JSON.stringify({ role: "assistant", content: [{ type: "text", text: "good" }] }) +
          "\n" +
          "not valid json\n",
        "utf-8",
      );

      await state.prepopulateStreamFiles(tmpDir);

      const messages = state.getConversationMessages("partial-agent");
      expect(messages.length).toBe(1);
    });

    it("caps merged messages at MAX_AGENT_EVENTS", async () => {
      const msgPath = join(tmpDir, "overflow-agent.messages.jsonl");
      const lines: string[] = [];
      for (let i = 0; i < 250; i++) {
        lines.push(
          JSON.stringify({ role: "assistant", content: [{ type: "text", text: `msg ${i}` }] }),
        );
      }
      writeFileSync(msgPath, lines.join("\n") + "\n", "utf-8");

      await state.prepopulateStreamFiles(tmpDir);

      const messages = state.getConversationMessages("overflow-agent");
      expect(messages.length).toBeLessThanOrEqual(200);
    });
  });

  // ── getAgentTools ─────────────────────────────────────────

  describe("getAgentTools", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = makeTempDir();
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("populates the tool log live from pushStreamEvent (start + end)", () => {
      state.setStreamDir(tmpDir);
      state.pushStreamEvent(
        "agent-x",
        {
          type: "tool_execution_start",
          toolCallId: "tc-1",
          toolName: "bash",
          args: { cmd: "ls" },
        },
        defaultFormat,
      );
      state.pushStreamEvent(
        "agent-x",
        {
          type: "tool_execution_end",
          toolCallId: "tc-1",
          toolName: "bash",
          result: "file listing",
          isError: false,
        },
        defaultFormat,
      );

      const tools = state.getAgentTools("agent-x");
      expect(tools).toHaveLength(2);
      expect(tools[0]).toMatchObject({
        toolCallId: "tc-1",
        toolName: "bash",
        args: { cmd: "ls" },
      });
      // The entries are typed AgentToolEntry objects: every entry carries the
      // ISO ts stamp, matching the journal record shape.
      expect(typeof tools[0].ts).toBe("string");
      // The end entry carries the args merged from the matching start.
      expect(tools[1]).toMatchObject({
        toolCallId: "tc-1",
        toolName: "bash",
        result: "file listing",
        isError: false,
        args: { cmd: "ls" },
      });
      expect(typeof tools[1].ts).toBe("string");
    });

    it("replays tool entries from the journal into the tool log", async () => {
      writeFileSync(
        join(tmpDir, "agent-x.journal.jsonl"),
        JSON.stringify({
          type: "tool",
          toolCallId: "tc-1",
          toolName: "bash",
          args: { cmd: "ls" },
          ts: "2026-01-01T00:00:01.000Z",
        }) +
          "\n" +
          JSON.stringify({
            type: "tool",
            toolCallId: "tc-1",
            toolName: "bash",
            result: "listing",
            isError: false,
            ts: "2026-01-01T00:00:02.000Z",
          }) +
          "\n",
        "utf-8",
      );

      await state.prepopulateStreamFiles(tmpDir);

      const tools = state.getAgentTools("agent-x");
      expect(tools).toHaveLength(2);
      expect(tools[0]).toMatchObject({
        toolCallId: "tc-1",
        toolName: "bash",
        args: { cmd: "ls" },
      });
      // Replayed entries carry the journal's ts stamp (AgentToolEntry shape).
      expect(tools[0].ts).toBe("2026-01-01T00:00:01.000Z");
      expect(tools[1]).toMatchObject({
        toolCallId: "tc-1",
        toolName: "bash",
        result: "listing",
        isError: false,
      });
      expect(tools[1].ts).toBe("2026-01-01T00:00:02.000Z");
    });

    it("omits args from the live tool log when no start recorded them (matches replay)", () => {
      state.setStreamDir(tmpDir);
      // An end event with no preceding start — args were never captured.
      state.pushStreamEvent(
        "agent-x",
        {
          type: "tool_execution_end",
          toolCallId: "tc-1",
          toolName: "bash",
          result: "listing",
          isError: false,
        },
        defaultFormat,
      );

      const tools = state.getAgentTools("agent-x");
      expect(tools).toHaveLength(1);
      // Live and replayed tool logs share one shape: no args key when the
      // value would be undefined (replay omits it, so live must too).
      expect(tools[0]).not.toHaveProperty("args");
      expect(tools[0]).toMatchObject({
        toolCallId: "tc-1",
        toolName: "bash",
        result: "listing",
        isError: false,
      });
    });

    it("omits isError from the live tool log and journal when the end event has none", () => {
      state.setStreamDir(tmpDir);
      // An end event without isError — the key must be omitted from both
      // the live tool log and the journal entry, exactly as replay shapes
      // them (M2 shape parity).
      state.pushStreamEvent(
        "agent-x",
        {
          type: "tool_execution_end",
          toolCallId: "tc-1",
          toolName: "bash",
          result: "listing",
        } as unknown as JsonAgentSessionEvent,
        defaultFormat,
      );

      const tools = state.getAgentTools("agent-x");
      expect(tools).toHaveLength(1);
      expect(tools[0]).not.toHaveProperty("isError");
      expect(tools[0]).toMatchObject({
        toolCallId: "tc-1",
        toolName: "bash",
        result: "listing",
      });

      const journalTool = readJournal(tmpDir, "agent-x").find(
        (e): e is Extract<AgentJournalEntry, { type: "tool" }> =>
          e.type === "tool" && e.toolCallId === "tc-1" && "result" in e,
      );
      expect(journalTool).toBeDefined();
      expect(journalTool).not.toHaveProperty("isError");
    });

    it("returns an empty array for unknown agents", () => {
      expect(state.getAgentTools("nonexistent")).toEqual([]);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────

  describe("edge cases", () => {
    it("getAgentEntry returns undefined for unknown agent", () => {
      expect(state.getAgentEntry("nonexistent")).toBeUndefined();
    });

    it("getLastLine returns undefined for unknown agent", () => {
      expect(state.getLastLine("nonexistent")).toBeUndefined();
    });

    it("setStreamDir and getStreamDir", () => {
      expect(state.getStreamDir()).toBeUndefined();
      state.setStreamDir("/tmp/test");
      expect(state.getStreamDir()).toBe("/tmp/test");
    });
  });
});
