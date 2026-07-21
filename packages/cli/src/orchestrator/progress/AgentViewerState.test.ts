import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentViewerState } from "./AgentViewerState";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "agent-viewer-state-test-"));
}

// ── Event factories ─────────────────────────────────────────

function makeAgentStartEvent(): AgentEvent {
  return { type: "agent_start" };
}

function makeMessageEndEvent(content: string, role = "assistant"): AgentEvent {
  return {
    type: "message_end",
    message: {
      role,
      content: [{ type: "text", text: content }],
    },
  } as unknown as AgentEvent;
}

function makeMessageStartEvent(role = "assistant"): AgentEvent {
  return {
    type: "message_start",
    message: { role, content: [] },
  } as unknown as AgentEvent;
}

function makeMessageUpdateEvent(content: string, role = "assistant"): AgentEvent {
  return {
    type: "message_update",
    message: {
      role,
      content: [{ type: "text", text: content }],
    },
  } as unknown as AgentEvent;
}

function makeTurnStartEvent(): AgentEvent {
  return { type: "turn_start" };
}

function makeTurnEndEvent(): AgentEvent {
  return { type: "turn_end" } as AgentEvent;
}

// ── Format helper ───────────────────────────────────────────

function defaultFormat(event: AgentEvent): string {
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
      const entry = state.getAgentEntry("builder");
      expect(entry!.status).toBe("done");
      expect(entry!.summary).toBe("Build passed");
      expect(entry!.passed).toBe(true);
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

    it("loadConversationEvents reads from disk when in-memory buffer is insufficient", async () => {
      state.setStreamDir(tmpDir);

      // Write 5 events to .events.jsonl
      const eventsPath = join(tmpDir, "agent-x.events.jsonl");
      const diskEvents: AgentEvent[] = [];
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
  });

  // ── extractMessageFromEvent (static) ───────────────────────

  describe("extractMessageFromEvent", () => {
    it("extracts message from message_start", () => {
      const msg = AgentViewerState.extractMessageFromEvent({
        type: "message_start",
        message: { role: "user", content: "hello" },
      } as unknown as AgentEvent);
      expect(msg).toBeDefined();
      expect(msg!.role).toBe("user");
    });

    it("extracts message from message_update", () => {
      const msg = AgentViewerState.extractMessageFromEvent({
        type: "message_update",
        message: { role: "assistant", content: "streaming..." },
      } as unknown as AgentEvent);
      expect(msg).toBeDefined();
    });

    it("extracts message from message_end", () => {
      const msg = AgentViewerState.extractMessageFromEvent({
        type: "message_end",
        message: { role: "assistant", content: "done" },
      } as unknown as AgentEvent);
      expect(msg).toBeDefined();
    });

    it("returns undefined for non-message events", () => {
      expect(AgentViewerState.extractMessageFromEvent({ type: "agent_start" })).toBeUndefined();
      expect(AgentViewerState.extractMessageFromEvent({ type: "turn_start" })).toBeUndefined();
      expect(
        AgentViewerState.extractMessageFromEvent({
          type: "tool_execution_start",
          toolName: "bash",
        } as unknown as AgentEvent),
      ).toBeUndefined();
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
