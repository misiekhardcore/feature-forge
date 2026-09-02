import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { TypedEventBus } from "@feature-forge/core/event-bus";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeMockTypedEventBus } from "../../test-utils";
import {
  agentStartEvent,
  assistantMessage,
  messageEndEvent,
  text,
  toolEndEvent,
  toolStartEvent,
} from "../test-utils";
import type { AgentJournalEntry } from "./AgentJournal";
import { AgentJournalRecorder } from "./AgentJournalRecorder";
import { AgentViewerState } from "./AgentViewerState";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "agent-journal-recorder-test-"));
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

// ── Payload builders (single D4 channel contract) ───────────

function startedPayload(agentId: string) {
  return {
    phase: "agent-started" as const,
    message: `Agent "${agentId}" started`,
    details: { executionId: "exec-1", agentId },
  };
}

function streamPayload(agentId: string, event: JsonAgentSessionEvent) {
  return {
    phase: "agent-stream" as const,
    message: `Agent "${agentId}" stream event`,
    details: { executionId: "exec-1", agentId, label: agentId, event },
  };
}

function donePayload(agentId: string, passed?: boolean, summary?: string) {
  return {
    phase: "agent-done" as const,
    message: `Agent "${agentId}" done`,
    details: { executionId: "exec-1", agentId, passed, summary },
  };
}

function lifecycleEntries(
  entries: AgentJournalEntry[],
): Extract<AgentJournalEntry, { type: "lifecycle" }>[] {
  return entries.filter(
    (e): e is Extract<AgentJournalEntry, { type: "lifecycle" }> => e.type === "lifecycle",
  );
}

function streamLines(entries: AgentJournalEntry[]): string[] {
  return entries
    .filter((e): e is Extract<AgentJournalEntry, { type: "stream" }> => e.type === "stream")
    .map((e) => e.line);
}

function toolEntries(entries: AgentJournalEntry[]): Extract<AgentJournalEntry, { type: "tool" }>[] {
  return entries.filter(
    (e): e is Extract<AgentJournalEntry, { type: "tool" }> => e.type === "tool",
  );
}

// ── Tests ───────────────────────────────────────────────────

describe("AgentJournalRecorder", () => {
  let bus: TypedEventBus;
  let streamDir: string;
  let recorder: AgentJournalRecorder;

  beforeEach(() => {
    bus = makeMockTypedEventBus();
    streamDir = makeTempDir();
    recorder = new AgentJournalRecorder({ eventBus: bus, streamDir });
  });

  afterEach(() => {
    recorder.dispose();
    rmSync(streamDir, { recursive: true, force: true });
  });

  // ── subscribe / dispose lifecycle ─────────────────────────

  describe("subscribe / dispose lifecycle", () => {
    it("journals the started lifecycle of an agent that spawns after subscribe (no pre-connect loss)", () => {
      // THE bug case: the recorder subscribes before the routine spawns
      // agents, so the first agent's started lands in the journal even
      // though no viewer ever connected.
      recorder.subscribe();

      bus.emit("feature-forge:agent-started", startedPayload("builder"));

      const entries = readJournal(streamDir, "builder");
      expect(lifecycleEntries(entries)).toHaveLength(1);
      expect(lifecycleEntries(entries)[0]).toMatchObject({
        type: "lifecycle",
        phase: "started",
      });
      expect(lifecycleEntries(entries)[0].ts).toBeTypeOf("string");
    });

    it("does not journal anything before subscribe (no surprise writes)", () => {
      bus.emit("feature-forge:agent-started", startedPayload("builder"));
      bus.emit("feature-forge:agent-stream", streamPayload("builder", agentStartEvent()));
      bus.emit("feature-forge:agent-done", donePayload("builder", true, "ran headless"));

      expect(readdirSync(streamDir).filter((f) => f.endsWith(".journal.jsonl"))).toEqual([]);
    });

    it("subscribe is idempotent - each event is journaled exactly once", () => {
      recorder.subscribe();
      recorder.subscribe();

      bus.emit("feature-forge:agent-started", startedPayload("builder"));

      expect(lifecycleEntries(readJournal(streamDir, "builder"))).toHaveLength(1);
    });

    it("dispose unsubscribes - later events no longer journal; double dispose does not throw", () => {
      recorder.subscribe();
      bus.emit("feature-forge:agent-started", startedPayload("builder"));

      recorder.dispose();
      recorder.dispose();

      // Post-dispose traffic must not append to the journal.
      bus.emit("feature-forge:agent-stream", streamPayload("builder", agentStartEvent()));
      bus.emit("feature-forge:agent-done", donePayload("builder", false, "ignored"));

      const entries = readJournal(streamDir, "builder");
      expect(lifecycleEntries(entries)).toHaveLength(1);
      expect(lifecycleEntries(entries)[0]).toMatchObject({ type: "lifecycle", phase: "started" });
    });

    it("dispose before any subscribe does not throw, and a released recorder never re-subscribes", () => {
      recorder.dispose();

      // A later subscribe on the released recorder is a no-op - events stay
      // unjournaled and no listener throws.
      const unsubscribe = recorder.subscribe();
      expect(() => unsubscribe()).not.toThrow();
      expect(() =>
        bus.emit("feature-forge:agent-done", donePayload("builder", true, "late")),
      ).not.toThrow();
      expect(readdirSync(streamDir).filter((f) => f.endsWith(".journal.jsonl"))).toEqual([]);
    });

    it("ignores payloads without an agentId or stream event (best-effort guard)", () => {
      recorder.subscribe();

      expect(() => {
        bus.emit("feature-forge:agent-started", {
          phase: "agent-started",
          message: "no agent",
          details: { executionId: "exec-1", agentId: "" },
        });
        bus.emit("feature-forge:agent-done", {
          phase: "agent-done",
          message: "no agent",
          details: { executionId: "exec-1", agentId: "" },
        });
        // A stream payload missing its event must not throw or journal.
        bus.raw.emit("feature-forge:agent-stream", {
          phase: "agent-stream",
          message: "no event",
          details: { executionId: "exec-1", agentId: "builder", label: "builder" },
        });
      }).not.toThrow();

      expect(readdirSync(streamDir).filter((f) => f.endsWith(".journal.jsonl"))).toEqual([]);
    });
  });

  // ── Journal content derivation ────────────────────────────

  describe("journal content derivation", () => {
    it("journals stream, tool, and message entries from agent-stream events", () => {
      recorder.subscribe();

      bus.emit("feature-forge:agent-started", startedPayload("builder"));

      bus.emit(
        "feature-forge:agent-stream",
        streamPayload("builder", toolStartEvent("bash", { command: "ls -la" })),
      );
      bus.emit(
        "feature-forge:agent-stream",
        streamPayload("builder", toolEndEvent("bash", "listing")),
      );
      bus.emit(
        "feature-forge:agent-stream",
        streamPayload("builder", messageEndEvent(assistantMessage([text("Hello world")]))),
      );

      const entries = readJournal(streamDir, "builder");

      // stream entries carry the same formatted lines the viewer derives.
      const lines = streamLines(entries);
      expect(lines[0]).toContain("bash");
      expect(lines[0]).toContain("command");
      expect(lines).toContain("bash (ok)");
      expect(lines).toContain("Hello world");

      // tool entries: start records args, end merges them back in.
      const tools = toolEntries(entries);
      expect(tools).toHaveLength(2);
      expect(tools[0]).toMatchObject({
        type: "tool",
        toolCallId: "tc-1",
        toolName: "bash",
        args: { command: "ls -la" },
      });
      expect(tools[1]).toMatchObject({
        type: "tool",
        toolCallId: "tc-1",
        toolName: "bash",
        result: "listing",
        isError: false,
        args: { command: "ls -la" },
      });

      // message entry carries the finalized assistant message.
      const messages = entries.filter(
        (e): e is Extract<AgentJournalEntry, { type: "message" }> => e.type === "message",
      );
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        type: "message",
        message: { role: "assistant", content: [{ type: "text", text: "Hello world" }] },
      });
    });

    it("journals the done lifecycle with passed and summary from agent-done", () => {
      recorder.subscribe();

      bus.emit("feature-forge:agent-started", startedPayload("builder"));
      bus.emit("feature-forge:agent-done", donePayload("builder", true, "Build passed"));

      const lifecycles = lifecycleEntries(readJournal(streamDir, "builder"));
      expect(lifecycles).toHaveLength(2);
      expect(lifecycles[0]).toMatchObject({ type: "lifecycle", phase: "started" });
      expect(lifecycles[1]).toMatchObject({
        type: "lifecycle",
        phase: "done",
        passed: true,
        summary: "Build passed",
      });
    });

    it("journals a passed=false agent-done as done with passed=false (truthful negative verdict)", () => {
      recorder.subscribe();

      bus.emit("feature-forge:agent-started", startedPayload("builder"));
      bus.emit("feature-forge:agent-done", donePayload("builder", false, "Build failed"));

      const lifecycles = lifecycleEntries(readJournal(streamDir, "builder"));
      expect(lifecycles[1]).toMatchObject({
        type: "lifecycle",
        phase: "done",
        passed: false,
        summary: "Build failed",
      });
    });

    it("journals agent-done without a passed flag as done (truthful pass-unknown)", () => {
      recorder.subscribe();

      bus.emit("feature-forge:agent-started", startedPayload("builder"));
      bus.emit("feature-forge:agent-done", donePayload("builder", undefined, "Finished"));

      const lifecycles = lifecycleEntries(readJournal(streamDir, "builder"));
      expect(lifecycles[1]).toMatchObject({
        type: "lifecycle",
        phase: "done",
        summary: "Finished",
      });
      // No passed flag in the payload → no passed key on disk (undefined
      // fields are dropped by JSON serialization).
      expect(lifecycles[1]).not.toHaveProperty("passed");
    });
  });

  // ── Parallel agents ───────────────────────────────────────

  describe("parallel agents", () => {
    it("completes both journals across interleaved agents with terminal lifecycles", () => {
      // The reproduced bug scenario: two agents run in parallel and BOTH
      // journals must end with their terminal done lifecycle.
      recorder.subscribe();

      bus.emit("feature-forge:agent-started", startedPayload("builder"));
      bus.emit("feature-forge:agent-started", startedPayload("reviewer"));

      // Interleaved streaming.
      bus.emit("feature-forge:agent-stream", streamPayload("builder", agentStartEvent()));
      bus.emit("feature-forge:agent-stream", streamPayload("reviewer", agentStartEvent()));
      bus.emit(
        "feature-forge:agent-stream",
        streamPayload("builder", messageEndEvent(assistantMessage([text("built")]))),
      );
      bus.emit(
        "feature-forge:agent-stream",
        streamPayload("reviewer", messageEndEvent(assistantMessage([text("reviewed")]))),
      );

      bus.emit("feature-forge:agent-done", donePayload("builder", true, "Build passed"));
      bus.emit("feature-forge:agent-done", donePayload("reviewer", false, "Review failed"));

      const builder = lifecycleEntries(readJournal(streamDir, "builder"));
      const reviewer = lifecycleEntries(readJournal(streamDir, "reviewer"));

      // Both journals are complete: started then done per agent, each with
      // its truthful terminal - builder passed (done + passed:true),
      // reviewer failed (done + passed:false, payload-truthful negative
      // verdict - no fleet status available to the recorder, so no "error").
      expect(builder).toHaveLength(2);
      expect(builder[0]).toMatchObject({ type: "lifecycle", phase: "started" });
      expect(builder[1]).toMatchObject({
        type: "lifecycle",
        phase: "done",
        passed: true,
        summary: "Build passed",
      });
      expect(reviewer).toHaveLength(2);
      expect(reviewer[0]).toMatchObject({ type: "lifecycle", phase: "started" });
      expect(reviewer[1]).toMatchObject({
        type: "lifecycle",
        phase: "done",
        passed: false,
        summary: "Review failed",
      });

      // Interleaving never mixed the journals: each file holds only its own
      // agent's stream/message content.
      expect(streamLines(readJournal(streamDir, "builder"))).toContain("built");
      expect(streamLines(readJournal(streamDir, "builder"))).not.toContain("reviewed");
      expect(streamLines(readJournal(streamDir, "reviewer"))).toContain("reviewed");
      expect(streamLines(readJournal(streamDir, "reviewer"))).not.toContain("built");
    });
  });

  // ── Single-writer gate (AgentViewerState) ─────────────────

  describe("single-writer gate", () => {
    it("a display-mode state with streamDir set never writes yet still replays reads", async () => {
      const state = new AgentViewerState();
      state.setJournaling(false);

      // A journal from a prior run sits in the stream directory. Replay
      // reads are ungated: prepopulate populates caches while journaling is
      // disabled.
      writeFileSync(
        join(streamDir, "builder.journal.jsonl"),
        JSON.stringify({ type: "lifecycle", phase: "started", ts: "2026-01-01T00:00:00.000Z" }) +
          "\n" +
          JSON.stringify({
            type: "message",
            message: { role: "assistant", content: [{ type: "text", text: "replayed" }] },
            ts: "2026-01-01T00:00:01.000Z",
          }) +
          "\n",
        "utf-8",
      );
      await state.prepopulateStreamFiles(streamDir);
      expect(state.getConversationMessages("builder").length).toBe(1);

      // Display-only live traffic: in-memory caches still update...
      state.pushStreamEvent("builder", agentStartEvent(), () => "agent_start: detail");
      state.appendLifecycle("builder", "done", true, "must not hit disk");
      expect(state.getLastLine("builder")).toBe("agent_start: detail");

      // ...but the journal file bytes never change (single-writer proof).
      const before = readFileSync(join(streamDir, "builder.journal.jsonl"), "utf-8");
      expect(readdirSync(streamDir).filter((f) => f.endsWith(".journal.jsonl"))).toEqual([
        "builder.journal.jsonl",
      ]);
      expect(readFileSync(join(streamDir, "builder.journal.jsonl"), "utf-8")).toBe(before);
    });

    it("re-enabling journaling resumes disk writes on the same state", () => {
      const state = new AgentViewerState();
      state.setStreamDir(streamDir);
      state.setJournaling(false);
      state.appendLifecycle("builder", "started");
      expect(readJournal(streamDir, "builder")).toEqual([]);

      state.setJournaling(true);
      state.appendLifecycle("builder", "done", true, "now writing again");
      expect(readJournal(streamDir, "builder")).toHaveLength(1);
      expect(readJournal(streamDir, "builder")[0]).toMatchObject({
        type: "lifecycle",
        phase: "done",
        passed: true,
        summary: "now writing again",
      });
    });
  });
});
