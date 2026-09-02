/**
 * Live agent-journal validation with REAL pi subprocess agents.
 *
 * Opt-in test (skipped unless `FORGE_LIVE_AGENT_TEST=1`) that drives the
 * production agent-run chain end-to-end with genuine subprocess agents and a
 * real model provider:
 *
 *   supervisor.spawnGuest(spec)            -> real pi --mode rpc child
 *   feature-forge:agent-started           -> recorder journals lifecycle started
 *   agent.executeTask(prompt, { onEvent }) -> feature-forge:agent-stream     -> journal stream/message/tool
 *   feature-forge:agent-done              -> recorder journals lifecycle done (passed + summary)
 *   supervisor.destroyAgent(id)
 *
 * Two agents run in PARALLEL to reproduce the review+verify concurrency
 * pattern from the live-session anomaly (PR #249 amendment), then the
 * journal is replayed by a fresh AgentViewerState to verify truthful reopen.
 *
 * Why this test exists: unit and e2e suites use mock agents / fake models
 * (see e2e/helpers.ts createMockAgent), and the TUI viewer only displays in
 * interactive pi sessions (`ctx.hasUI`). This harness drives the routine-layer
 * journal pipeline (AgentJournalRecorder over the real event bus and the real
 * supervisor) so real agent payloads flow through recorder -> journal append,
 * and re-verifies that a fresh AgentViewerState replays the journals
 * truthfully - the same path the viewer overlay uses for reopen replay.
 *
 * Usage (real model, ~2 short LLM calls):
 *   FORGE_LIVE_AGENT_TEST=1 npx vitest run --project cli-e2e \
 *     e2e/live-agent-journal.e2e.test.ts
 * Optional model override: FORGE_LIVE_AGENT_MODEL="provider/model"
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEventBus } from "@earendil-works/pi-coding-agent";
import { DynamicAgentSpecification } from "@feature-forge/core/agents";
import { InMemoryAgentSupervisor } from "@feature-forge/core/agents";
import { PiSubprocessAgentFactory } from "@feature-forge/core/agents";
import { TypedEventBus } from "@feature-forge/core/event-bus";
import { describe, expect, it } from "vitest";

import { AgentJournalRecorder } from "../src/tui/state/AgentJournalRecorder";
import { AgentViewerState } from "../src/tui/state/AgentViewerState";

const LIVE = process.env.FORGE_LIVE_AGENT_TEST === "1";
const MODEL = process.env.FORGE_LIVE_AGENT_MODEL;

/** Parse an agent's journal file into entries ([] when absent). */
function readJournal(streamDir: string, agentId: string): Array<Record<string, unknown>> {
  const journalPath = join(streamDir, `${agentId}.journal.jsonl`);
  if (!existsSync(journalPath)) return [];
  return readFileSync(journalPath, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function lifecyclePhases(journal: Array<Record<string, unknown>>): string[] {
  return journal
    .filter((entry) => entry.type === "lifecycle")
    .map((entry) => entry.phase as string);
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe.skipIf(!LIVE)("live agent journal (real subprocess agents)", () => {
  it("journals two parallel real agents with truthful terminals and replays them", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "forge-live-journal-"));
    const streamDir = join(scratch, "streams");
    mkdirSync(streamDir, { recursive: true });

    // Real supervisor + factory. Children spawn the global pi CLI in RPC
    // mode with the user's default provider/model (or the env override).
    const childEnv = { ...process.env } as Record<string, string>;
    delete childEnv.FORGE_PARENT_SOCKET;
    delete childEnv.FORGE_SPEC;
    const supervisor = new InMemoryAgentSupervisor(
      new PiSubprocessAgentFactory(
        { env: childEnv, cwd: scratch },
        {}, // no model presets -> child pi uses its default model
      ),
    );

    // Real event bus shared by the emitters and the recorder.
    const eventBus = new TypedEventBus(createEventBus());

    // Routine-layer journal recorder: the single disk writer (mirrors
    // RoutineTool's wiring - subscribe BEFORE agents spawn so the first
    // agent-started is captured).
    const recorder = new AgentJournalRecorder({ eventBus, streamDir });
    recorder.subscribe();

    const agents = [
      { id: "live-review", role: "live-review", token: "LIVE_REVIEW_OK" },
      { id: "live-verify", role: "live-verify", token: "LIVE_VERIFY_OK" },
    ];

    try {
      // Two REAL subprocess agents in parallel (review+verify pattern).
      await Promise.all(
        agents.map(async ({ id, role, token }) => {
          const spec = new DynamicAgentSpecification({
            id,
            role,
            systemPrompt:
              "You are a live journal test agent. Reply with exactly the requested token and nothing else.",
            model: MODEL,
            disableBuiltinTools: true,
            disableExtensions: true,
            disableSkills: true,
            disablePromptTemplates: true,
            disableContextFiles: true,
            ephemeral: true,
          });
          const agent = await supervisor.spawnGuest(spec);
          const executionId = randomUUID();

          eventBus.emit("feature-forge:agent-started", {
            phase: "agent-started",
            message: `Agent ${id} started`,
            details: { executionId, agentId: id },
          });

          const result = await agent.executeTask(`Reply with exactly: ${token}`, {
            onEvent: (event) => {
              eventBus.emit("feature-forge:agent-stream", {
                phase: "agent-stream",
                message: `Agent ${id} stream`,
                details: { executionId, agentId: id, label: role, event },
              });
            },
          });

          eventBus.emit("feature-forge:agent-done", {
            phase: "agent-done",
            message: `Agent ${id} done`,
            details: { executionId, agentId: id, passed: true, summary: result },
          });

          await supervisor.destroyAgent(id);
          return result;
        }),
      );

      // 1. Both journals exist with truthful lifecycle terminals.
      for (const { id, token } of agents) {
        const journal = readJournal(streamDir, id);
        const phases = lifecyclePhases(journal);
        expect(phases).toContain("started");
        const terminal = journal.filter((e) => e.type === "lifecycle").at(-1);
        expect(terminal).toMatchObject({ type: "lifecycle", phase: "done", passed: true });
        // The summary must carry the REAL model output (proves a live agent
        // produced the result rather than an empty/error string).
        expect((terminal as { summary?: string }).summary).toContain(token);

        // Stream-path proof: the assistant's real reply must also be journaled
        // as a message record. Lifecycle-only assertions above would pass even
        // if agent-stream events never reached the recorder - this check proves
        // the agent-stream -> pushStreamEvent -> journal-append path carried
        // genuine payloads. User-role records are ignored (the task prompt
        // embeds the token too).
        const assistantReplies = journal.filter(
          (entry) =>
            entry.type === "message" &&
            (entry as { message?: { role?: string } }).message?.role === "assistant",
        );
        expect(assistantReplies.length).toBeGreaterThan(0);
        expect(JSON.stringify(assistantReplies)).toContain(token);
      }

      // 2. Reopen replay: a fresh state derives truthful entries from disk.
      const reopened = new AgentViewerState();
      await reopened.prepopulateStreamFiles(streamDir);
      for (const { id, token } of agents) {
        const entry = reopened.getAgentEntry(id);
        expect(entry).toBeDefined();
        expect(entry?.status).toBe("done");
        if (entry?.status === "done") {
          expect(entry.passed).toBe(true);
          expect(entry.finishedAt).toBeInstanceOf(Date);
          // The replayed terminal must still carry the real model output.
          expect(entry.summary).toContain(token);
        }
        // Replay must reconstruct the real conversation from the journal's
        // message records (assistant role only - the task prompt embeds the
        // token in the user record too), not merely the terminal summary.
        const assistantMessages = reopened
          .getAgentMessages(id)
          .filter((message) => message.role === "assistant");
        expect(JSON.stringify(assistantMessages)).toContain(token);
      }
    } finally {
      recorder.dispose();
      for (const { id } of agents) {
        await supervisor.destroyAgent(id).catch(() => undefined);
      }
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 240_000);
});
