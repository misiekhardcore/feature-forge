import {
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

import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentViewerEntry } from "../types";
import { AgentViewerState, MAX_EVENTS_FILE_LINES } from "./AgentViewerState";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "agent-viewer-state-test-"));
}

// ── Event factories ─────────────────────────────────────────

function makeAgentStartEvent(): JsonAgentSessionEvent {
  return { type: "agent_start" };
}

function makeMessageEndEvent(content: string, role = "assistant"): JsonAgentSessionEvent {
  return {
    type: "message_end",
    message: {
      role,
      content: [{ type: "text", text: content }],
    },
  } as unknown as JsonAgentSessionEvent;
}

function makeMessageStartEvent(role = "assistant"): JsonAgentSessionEvent {
  return {
    type: "message_start",
    message: { role, content: [] },
  } as unknown as JsonAgentSessionEvent;
}

function makeMessageUpdateEvent(content: string): JsonAgentSessionEvent {
  return {
    type: "message_update",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: content },
  } as unknown as JsonAgentSessionEvent;
}

function makeTurnStartEvent(): JsonAgentSessionEvent {
  return { type: "turn_start" };
}

function makeTurnEndEvent(): JsonAgentSessionEvent {
  return { type: "turn_end" } as unknown as JsonAgentSessionEvent;
}

// ── Format helper ───────────────────────────────────────────

function defaultFormat(event: JsonAgentSessionEvent): string {
  return `${event.type}: detail`;
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

        // After a restart, prepopulate seeds the stale entry from the stream
        // file (birthtime createdAt, mtime finishedAt) and connect() then
        // re-delivers done with the run-record createdAt — close to, but not
        // identical to, the seeded one. A changed createdAt alone must NOT
        // trigger a re-stamp: the existing stamp is the real finish time and
        // re-stamping would inflate elapsed by the whole downtime.
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

    it("replaces last message for message_update (dedup)", () => {
      state.pushStreamEvent("builder", makeMessageStartEvent(), defaultFormat);
      expect(state.getConversationMessages("builder").length).toBe(1);

      state.pushStreamEvent("builder", makeMessageUpdateEvent("updated text"), defaultFormat);
      const messages = state.getConversationMessages("builder");
      expect(messages.length).toBe(1); // Still 1 — replaced, not appended
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
      // The per-agent events file line counter must be reset too.
      const internal = state as unknown as { eventsFileLineCounts: Map<string, number> };
      expect(internal.eventsFileLineCounts.size).toBe(0);
    });

    it("clears all internal maps including eventsFileLineCounts after persistence", () => {
      const tmpDir = makeTempDir();
      try {
        state.setStreamDir(tmpDir);
        state.pushStreamEvent("builder", makeAgentStartEvent(), defaultFormat);
        state.pushStreamEvent("builder", makeMessageEndEvent("final"), defaultFormat);

        const internal = state as unknown as {
          agents: Map<string, unknown>;
          lastLines: Map<string, unknown>;
          agentEvents: Map<string, unknown>;
          agentMessages: Map<string, unknown>;
          eventsFileLineCounts: Map<string, number>;
          streamFiles: Map<string, unknown>;
          eventsFiles: Map<string, unknown>;
          messagesFiles: Map<string, unknown>;
          streamDir?: string;
        };

        // Persistence populated the line counter before dispose.
        expect(internal.eventsFileLineCounts.get("builder")).toBe(2);

        state.dispose();

        expect(internal.agents.size).toBe(0);
        expect(internal.lastLines.size).toBe(0);
        expect(internal.agentEvents.size).toBe(0);
        expect(internal.agentMessages.size).toBe(0);
        expect(internal.eventsFileLineCounts.size).toBe(0);
        expect(internal.streamFiles.size).toBe(0);
        expect(internal.eventsFiles.size).toBe(0);
        expect(internal.messagesFiles.size).toBe(0);
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

    it("persists stream events to .stream file when streamDir is set", () => {
      state.setStreamDir(tmpDir);
      state.pushStreamEvent("agent-x", makeAgentStartEvent(), defaultFormat);

      state.dispose();

      // .stream file should exist
      const files = readdirSync(tmpDir);
      const streamFile = files.find((f: string) => f.endsWith(".stream"));
      expect(streamFile).toBeDefined();
      if (streamFile) {
        const content = readFileSync(join(tmpDir, streamFile), "utf-8");
        expect(content).toContain("agent_start: detail");
      }
    });

    it("excludes turn_start, turn_end, message_update from .stream file", () => {
      state.setStreamDir(tmpDir);
      state.pushStreamEvent("agent-x", makeTurnStartEvent(), defaultFormat);
      state.pushStreamEvent("agent-x", makeTurnEndEvent(), defaultFormat);
      state.pushStreamEvent("agent-x", makeMessageUpdateEvent("update text"), defaultFormat);
      state.pushStreamEvent("agent-x", makeAgentStartEvent(), defaultFormat);

      state.dispose();

      const files = readdirSync(tmpDir);
      const streamFile = files.find((f: string) => f.endsWith(".stream"));
      if (streamFile) {
        const content = readFileSync(join(tmpDir, streamFile), "utf-8");
        expect(content).not.toContain("turn_start");
        expect(content).not.toContain("turn_end");
        expect(content).not.toContain("message_update");
        expect(content).toContain("agent_start");
      }
    });

    it("persists raw events to .events.jsonl", () => {
      state.setStreamDir(tmpDir);
      state.pushStreamEvent("agent-x", makeAgentStartEvent(), defaultFormat);

      state.dispose();

      const files = readdirSync(tmpDir);
      const eventsFile = files.find((f: string) => f.endsWith(".events.jsonl"));
      expect(eventsFile).toBeDefined();
      if (eventsFile) {
        const content = readFileSync(join(tmpDir, eventsFile), "utf-8");
        expect(content).toContain('"agent_start"');
      }
    });

    it("persists message_end to .messages.jsonl", () => {
      state.setStreamDir(tmpDir);
      state.pushStreamEvent("agent-x", makeMessageEndEvent("Hello"), defaultFormat);

      state.dispose();

      const files = readdirSync(tmpDir);
      const messagesFile = files.find((f: string) => f.endsWith(".messages.jsonl"));
      expect(messagesFile).toBeDefined();
      if (messagesFile) {
        const content = readFileSync(join(tmpDir, messagesFile), "utf-8");
        expect(content).toContain("Hello");
      }
    });

    it("prepopulateStreamFiles loads messages and creates stale entries", async () => {
      // Pre-write a .messages.jsonl file mimicking a prior session.
      const msgPath = join(tmpDir, "stale-agent.messages.jsonl");
      writeFileSync(
        msgPath,
        JSON.stringify({ role: "assistant", content: [{ type: "text", text: "prior" }] }) + "\n",
        "utf-8",
      );
      // Also write a .stream file.
      writeFileSync(join(tmpDir, "stale-agent.stream"), "old line\n", "utf-8");
      // Also write a .events.jsonl file.
      writeFileSync(
        join(tmpDir, "stale-agent.events.jsonl"),
        JSON.stringify({ type: "agent_start" }) + "\n",
        "utf-8",
      );

      await state.prepopulateStreamFiles(tmpDir);

      // Stale entry should have been created.
      const entry = state.getAgentEntry("stale-agent");
      expect(entry).toBeDefined();
      expect(entry!.status).toBe("done");

      // Messages should have been loaded from disk.
      const messages = state.getConversationMessages("stale-agent");
      expect(messages.length).toBe(1);
    });

    it("prepopulateStreamFiles preserves mtime-based finishedAt seeding", async () => {
      // A .stream file from a prior session carries its mtime as the
      // finishedAt hint; update() must preserve an explicit finishedAt on
      // terminal entries instead of overwriting it with a fresh stamp.
      const past = new Date("2026-01-01T00:00:00Z");
      const streamPath = join(tmpDir, "old-agent.stream");
      writeFileSync(streamPath, "old line\n", "utf-8");
      utimesSync(streamPath, past, past);

      await state.prepopulateStreamFiles(tmpDir);

      const entry = state.getAgentEntry("old-agent")!;
      expect(entry.status).toBe("done");
      expect(entry.finishedAt).toBeInstanceOf(Date);
      expect(entry.finishedAt!.getTime()).toBe(past.getTime());
    });

    it("prepopulateStreamFiles mtime seed survives connect-style terminal re-delivery", async () => {
      // After prepopulate, AgentViewerOverlay.connect() re-delivers done for
      // every still-Completed agent with the run-record createdAt — close to,
      // but not identical to, the birthtime-seeded createdAt. The mtime seed
      // must survive that re-delivery: it is the real finish time, and a
      // re-stamp would inflate elapsed by the whole downtime.
      const streamPath = join(tmpDir, "old-agent.stream");
      writeFileSync(streamPath, "old line\n", "utf-8");
      utimesSync(streamPath, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:05:00Z"));

      await state.prepopulateStreamFiles(tmpDir);

      const seeded = state.getAgentEntry("old-agent")!;
      expect(seeded.status).toBe("done");
      expect(seeded.finishedAt!.getTime()).toBe(new Date("2026-01-01T00:05:00Z").getTime());

      // connect() re-delivery: same run, run-record createdAt (ms-level
      // difference from the seed), no finishedAt.
      state.update({
        id: "old-agent",
        status: "done",
        passed: false,
        summary: "Agent completed",
        createdAt: new Date("2026-01-01T00:00:00.005Z"),
      });

      const redelivered = state.getAgentEntry("old-agent")!;
      expect(redelivered.finishedAt!.getTime()).toBe(new Date("2026-01-01T00:05:00Z").getTime());
      // Elapsed = mtime - run-record createdAt ≈ the real run duration.
      expect(redelivered.finishedAt!.getTime() - redelivered.createdAt.getTime()).toBeLessThan(
        10 * 60 * 1000,
      );
    });

    it("loadConversationEvents reads from disk when in-memory buffer is insufficient", async () => {
      state.setStreamDir(tmpDir);

      // Write 5 events to .events.jsonl
      const eventsPath = join(tmpDir, "agent-x.events.jsonl");
      const diskEvents: JsonAgentSessionEvent[] = [];
      for (let i = 0; i < 5; i++) {
        diskEvents.push({ type: "agent_start" });
      }
      writeFileSync(
        eventsPath,
        diskEvents.map((e) => JSON.stringify(e)).join("\n") + "\n",
        "utf-8",
      );

      // Only push 1 event in-memory
      state.pushStreamEvent("agent-x", makeMessageEndEvent("latest"), defaultFormat);

      // Events file should be registered during pushStreamEvent (it registers .events.jsonl
      // too). Then we manually register the events path to ensure loadConversationEvents finds it.
      // pushStreamEvent registers .events.jsonl, but since the write happens before the events
      // file is created... Let's pre-create the files path registration by prepopulating.
      await state.prepopulateStreamFiles(tmpDir);

      const events = await state.loadConversationEvents("agent-x", 10);
      // Should have at least the 5 disk events
      expect(events.length).toBeGreaterThanOrEqual(5);
    });

    it("rotates .events.jsonl to .events.1.jsonl at the line cap and starts a fresh file", async () => {
      // Pre-session .events.jsonl at exactly the cap, plus a stale archive
      // that the POSIX rename should overwrite.
      const eventsPath = join(tmpDir, "agent-x.events.jsonl");
      const lines = new Array(MAX_EVENTS_FILE_LINES)
        .fill(null)
        .map(() => JSON.stringify({ type: "agent_start" }));
      writeFileSync(eventsPath, lines.join("\n") + "\n", "utf-8");
      const archivePath = join(tmpDir, "agent-x.events.1.jsonl");
      writeFileSync(archivePath, "stale\n", "utf-8");

      state.setStreamDir(tmpDir);
      await state.prepopulateStreamFiles(tmpDir);

      // Arithmetic: seeded count 50_000. Push 1 appends the event first, so
      // the count reaches 50_001 and the archive rotates with cap + 1 lines
      // including the triggering event. Push 2 creates the fresh current file.
      state.pushStreamEvent("agent-x", makeAgentStartEvent(), defaultFormat);

      const archiveContent = readFileSync(archivePath, "utf-8");
      expect(archiveContent.split("\n").filter(Boolean)).toHaveLength(MAX_EVENTS_FILE_LINES + 1);
      expect(archiveContent.split("\n")[0]).toBe(JSON.stringify({ type: "agent_start" }));
      // The stale archive was overwritten, not appended to.
      expect(archiveContent).not.toContain("stale");

      state.pushStreamEvent("agent-x", makeAgentStartEvent(), defaultFormat);
      const currentContent = readFileSync(eventsPath, "utf-8");
      expect(currentContent.trim()).toBe(JSON.stringify({ type: "agent_start" }));
    });

    it("falls through to .messages.jsonl persistence when rotation rename fails", async () => {
      // Block the archive path with a directory so renameSync fails.
      mkdirSync(join(tmpDir, "agent-x.events.1.jsonl"));

      const eventsPath = join(tmpDir, "agent-x.events.jsonl");
      const lines = new Array(MAX_EVENTS_FILE_LINES)
        .fill(null)
        .map(() => JSON.stringify({ type: "agent_start" }));
      writeFileSync(eventsPath, lines.join("\n") + "\n", "utf-8");

      state.setStreamDir(tmpDir);
      await state.prepopulateStreamFiles(tmpDir);

      // Push appends first, then the rotation rename fails; the method must
      // fall through so the finalized message is still persisted.
      state.pushStreamEvent("agent-x", makeMessageEndEvent("survives rotation"), defaultFormat);

      const messagesPath = join(tmpDir, "agent-x.messages.jsonl");
      expect(readFileSync(messagesPath, "utf-8")).toContain("survives rotation");

      // The current events file still grew past the cap (best-effort append).
      const currentContent = readFileSync(eventsPath, "utf-8");
      expect(currentContent.split("\n").filter(Boolean)).toHaveLength(MAX_EVENTS_FILE_LINES + 1);
    });
  });

  // ── message_update delta assembly ─────────────────────────

  describe("message_update delta assembly", () => {
    it("accumulates text deltas into the partial message", () => {
      state.pushStreamEvent("builder", makeMessageStartEvent(), defaultFormat);
      state.pushStreamEvent("builder", makeMessageUpdateEvent("Hello "), defaultFormat);
      state.pushStreamEvent("builder", makeMessageUpdateEvent("world"), defaultFormat);

      const messages = state.getConversationMessages("builder");
      expect(messages.length).toBe(1);
      const content = (messages[0] as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toBe("Hello world");
    });

    it("replaces the assembled partial with the authoritative message_end", () => {
      state.pushStreamEvent("builder", makeMessageStartEvent(), defaultFormat);
      state.pushStreamEvent("builder", makeMessageUpdateEvent("partial"), defaultFormat);
      state.pushStreamEvent("builder", makeMessageEndEvent("final text"), defaultFormat);

      const messages = state.getConversationMessages("builder");
      expect(messages.length).toBe(1);
      const content = (messages[0] as { content: Array<{ type: string; text: string }> }).content;
      expect(content[0].text).toBe("final text");
    });

    it("starts fresh on a new message_start (stale deltas do not leak)", () => {
      state.pushStreamEvent("builder", makeMessageStartEvent(), defaultFormat);
      state.pushStreamEvent("builder", makeMessageUpdateEvent("first"), defaultFormat);
      state.pushStreamEvent("builder", makeMessageStartEvent(), defaultFormat);
      state.pushStreamEvent("builder", makeMessageUpdateEvent("second"), defaultFormat);

      const messages = state.getConversationMessages("builder");
      const last = messages[messages.length - 1] as {
        content: Array<{ type: string; text: string }>;
      };
      const content = last.content;
      expect(content[0].text).toBe("second");
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

    it("loads lines from .stream file", async () => {
      state.setStreamDir(tmpDir);
      state.pushStreamEvent("agent-x", makeAgentStartEvent(), defaultFormat);
      state.pushStreamEvent("agent-x", makeMessageEndEvent("hello"), defaultFormat);

      const lines = await state.loadStreamFile("agent-x");
      expect(lines.length).toBe(2);
      expect(lines[0]).toBe("agent_start: detail");
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

    it("loads messages from .messages.jsonl file", async () => {
      state.setStreamDir(tmpDir);
      state.pushStreamEvent("agent-x", makeMessageEndEvent("Hello world"), defaultFormat);

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

  // ── loadMessagesFromDiskIntoCache (via prepopulateStreamFiles) ─

  describe("loadMessagesFromDiskIntoCache", () => {
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
