import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { logger } from "@feature-forge/core";

import type { AgentViewerEntry, AgentViewerEntryStatus } from "../types";
import type { AgentJournalEntry, AgentJournalOptions, AgentToolEntry } from "./AgentJournal";
import { AgentJournal } from "./AgentJournal";

/**
 * Constructor options for an {@link AgentViewerState}.
 *
 * `journalRetention` carries the sink retention applied to every journal
 * this state creates (rotated segment size and count). When omitted,
 * journals fall back to the canonical defaults inside AgentJournal
 * (`DEFAULT_FORGE_CONFIG.logMaxBytes`/`logMaxFiles`). Configured values
 * are threaded from the composition side (the journal recorder receives
 * them from RoutineTool) - state never reads a config singleton itself.
 * Display-only overlay states (AgentViewerOverlay) construct without
 * options, so journals their replay-time legacy fold writes use the
 * canonical retention; the composition rewire (S8b) threads configured
 * values there too (accepted interim drift, legacy files only).
 */
export interface AgentViewerStateOptions {
  /** Sink retention for journals this state creates. */
  journalRetention?: AgentJournalOptions;
}

/**
 * Maximum raw events kept in memory per agent (sliding window FIFO).
 * Older events are evicted but persist on disk via the journal for lazy loading.
 *
 * Exported for the viewer suites to assert the same cap without hardcoding
 * the literal (the overlay test imports it).
 */
export const MAX_AGENT_EVENTS = 200;

/**
 * Pure logic class managing agent viewer state.
 *
 * Handles:
 * - Map of agent entries
 * - Streaming event buffers
 * - Append-only journal persistence (.journal.jsonl)
 * - Zero TUI dependencies
 */
export class AgentViewerState {
  /** Sink retention applied to journals this state creates (explicit, never config-derived). */
  private readonly journalRetention: AgentJournalOptions;

  constructor(options: AgentViewerStateOptions = {}) {
    this.journalRetention = options.journalRetention ?? {};
  }

  /** Maps agent id → agent entry. */
  private agents = new Map<string, AgentViewerEntry>();

  /** Monotonic version counter — incremented on every mutation. */
  private version = 0;

  /** Maps agent id → most recent formatted stream line. */
  private lastLines = new Map<string, string>();

  /** Maps agent id → tool-entry log in execution order (live mirror of journal tool records). */
  private agentTools = new Map<string, AgentToolEntry[]>();

  /** Directory used for filesystem-backed stream buffers. */
  private streamDir?: string;

  /**
   * Whether journal writes are enabled.
   *
   * Defaults to true (back-compat): any state configured with a stream
   * directory persists exactly as it did before the display/recorder split.
   * A display-only state calls {@link setJournaling} with false so streamDir
   * serves replay reads only - the journal recorder is the sole disk writer.
   */
  private journaling = true;

  /** Maps agent id → raw stream events in insertion order. */
  private agentEvents = new Map<string, JsonAgentSessionEvent[]>();

  /** Maps agent id → extracted AgentMessage objects in order. */
  private agentMessages = new Map<string, AgentMessage[]>();

  /** Maps agent id → append-only journal for the agent run. */
  private journals = new Map<string, AgentJournal>();

  /** Maps agent id → toolCallId → args captured at tool_execution_start. */
  private toolStartArgs = new Map<string, Map<string, unknown>>();

  /**
   * Get all agent entries as a read-only map.
   */
  getAgentEntries(): ReadonlyMap<string, AgentViewerEntry> {
    return this.agents;
  }

  /**
   * Get a specific agent entry by id.
   */
  getAgentEntry(id: string): AgentViewerEntry | undefined {
    return this.agents.get(id);
  }

  /**
   * Get the current version number. Incremented on every state mutation.
   */
  getVersion(): number {
    return this.version;
  }

  /**
   * Get the last formatted stream line for an agent.
   */
  getLastLine(agentId: string): string | undefined {
    return this.lastLines.get(agentId);
  }

  /**
   * Get raw stream events for an agent from the in-memory buffer.
   *
   * Returns events currently held in the sliding window (up to
   * {@link MAX_AGENT_EVENTS} per agent). Raw events are no longer persisted
   * to disk (the journal keeps the derived stream/message/tool records), so
   * the window is the only source.
   *
   * @param agentId - The agent to get events for.
   * @returns An array of events in insertion order, most recent last. Empty for unknown agents.
   */
  getAgentEvents(agentId: string): JsonAgentSessionEvent[] {
    return this.agentEvents.get(agentId) ?? [];
  }

  /**
   * Get cached {@link AgentMessage} objects for an agent in order.
   *
   * Messages are populated live from {@link pushStreamEvent} on each
   * {@code message_end} event and replayed from the agent journal on
   * startup via {@link prepopulateStreamFiles}.
   *
   * @param agentId - The agent to get messages for.
   * @returns An array of messages, most recent last. Empty for unknown agents.
   */
  getAgentMessages(agentId: string): AgentMessage[] {
    return this.agentMessages.get(agentId) ?? [];
  }

  /**
   * Get the tool-entry log for an agent, in execution order.
   *
   * Entries mirror the journal's {@code tool} records (the exported
   * {@link AgentToolEntry} shape): each {@code tool_execution_start} pushes
   * {@code { toolCallId, toolName, args, ts }} and each
   * {@code tool_execution_end} pushes the merged
   * {@code { toolCallId, toolName, args, result, isError, ts }} object. Live
   * pushes happen alongside journal persistence, and startup replay
   * populates the log from journal {@code tool} entries.
   *
   * @param agentId - The agent to get tool entries for.
   * @returns The tool-entry log, most recent last. Empty for unknown agents.
   */
  getAgentTools(agentId: string): readonly AgentToolEntry[] {
    return this.agentTools.get(agentId) ?? [];
  }

  /**
   * Get the number of tracked agents.
   */
  get entryCount(): number {
    return this.agents.size;
  }

  /**
   * Get all tracked agent ids in insertion order.
   *
   * @returns An array of agent id strings. Empty array when no agents are tracked.
   */
  getAgentIds(): string[] {
    return Array.from(this.agents.keys());
  }

  /**
   * Configure the stream file directory.
   *
   * When set AND journaling is enabled, every pushStreamEvent call
   * persists the formatted event line to the agent's append-only journal
   * file named `{agentId}.journal.jsonl` under the given directory. With
   * journaling disabled (display-only state) the directory serves replay
   * reads only (prepopulate/loaders) and live events never hit the disk -
   * the journal recorder owns writes.
   *
   * @param streamDir - Directory for filesystem-backed stream buffers.
   */
  setStreamDir(streamDir: string): void {
    if (streamDir !== this.streamDir) {
      // Journal instances are bound to the directory they were created for.
      // A directory change invalidates the cache so later appends land in
      // the new directory instead of silently continuing to write the old
      // one (journals are re-created lazily on the next append).
      this.journals.clear();
    }
    this.streamDir = streamDir;
  }

  /**
   * Get the configured stream directory for filesystem-backed buffers.
   *
   * @returns The stream directory path, or {@code undefined} if not yet set.
   */
  getStreamDir(): string | undefined {
    return this.streamDir;
  }

  /**
   * Enable or disable journal persistence.
   *
   * Journaling is enabled by default, so a state configured with a stream
   * directory alone writes journals (all pre-split behavior). A display-only
   * state passes `false` here: streamDir keeps serving replay reads
   * (prepopulate/loaders) and live events never touch the disk - the journal
   * recorder owns writing. One deliberate exception: replay-time legacy
   * migration ({@link prepopulateStreamFiles} → {@link AgentJournal.migrateLegacy})
   * can still write journal files when legacy .stream/.messages.jsonl/.events
   * files exist, because display replay must fold legacy agents regardless of
   * the gate - do NOT gate migration.
   *
   * @param enabled - Whether stream/lifecycle writes may hit journal files.
   */
  setJournaling(enabled: boolean): void {
    this.journaling = enabled;
  }

  /**
   * Push or update a single agent entry.
   *
   * Later calls for the same agent id merge with and overwrite prior state
   * so the viewer always reflects the most recent lifecycle status.
   */
  update(entry: AgentViewerEntry): void {
    const existing = this.agents.get(entry.id);
    // createdAt fallback: entry/existing win when present, otherwise stamp now
    // (callers may omit createdAt at runtime despite the type requiring it).
    const merged: AgentViewerEntry = {
      ...existing,
      ...entry,
      createdAt: entry.createdAt ?? existing?.createdAt ?? new Date(),
    };

    // Timestamp lifecycle: terminal entries (done/error) always carry a
    // finishedAt — a caller-provided stamp wins (e.g. journal replay of a
    // completed run) and an existing stamp is preserved (same-run
    // re-delivery: overlay reopen, restart redelivery after prepopulate,
    // duplicate terminal events), otherwise a fresh stamp is written (first
    // terminal transition or a new run whose started/running cleared it).
    // Non-terminal entries (started/running/cancelled) clear the stamp so
    // loop iterations that re-run the same agent id never inherit a stale
    // one (which would render negative or frozen elapsed time).
    if (merged.status === "done" || merged.status === "error") {
      merged.finishedAt = entry.finishedAt ?? existing?.finishedAt ?? new Date();
    } else {
      delete merged.finishedAt;
    }

    this.agents.set(entry.id, merged);
    this.version++;
  }

  /**
   * Remove all in-memory agent entries and reset view state.
   *
   * Does NOT clean up filesystem stream files — use dispose
   * for full cleanup when stream file persistence was configured via
   * setStreamDir.
   */
  clearMemory(): void {
    this.agents.clear();
  }

  /**
   * Dispose of all in-memory state.
   *
   * Does NOT delete journal files from disk — they are the persistent
   * record of the agent run and survive the state's lifetime.
   */
  dispose(): void {
    this.agents.clear();
    this.lastLines.clear();
    this.agentEvents.clear();
    this.agentMessages.clear();
    this.agentTools.clear();
    this.journals.clear();
    this.toolStartArgs.clear();
    this.streamDir = undefined;
  }

  /**
   * Push a streaming event for an agent.
   *
   * Formats the event into a human-readable line (kept in memory as the
   * most recent stream line) and, when streamDir is configured AND
   * journaling is enabled, appends it to the agent's journal file on disk.
   * With journaling disabled (display-only state) the in-memory caches and
   * tool bookkeeping stay live but no journal write happens.
   */
  pushStreamEvent(
    agentId: string,
    event: JsonAgentSessionEvent,
    formatEvent: (e: JsonAgentSessionEvent) => string,
  ): void {
    if (!this.agents.has(agentId)) {
      this.update({
        id: agentId,
        status: "started",
        createdAt: new Date(),
      });
    }

    const line = formatEvent(event);
    if (event.type !== "message_update") {
      // Streaming deltas change nothing visible — the conversation updates
      // at message_end, so keep the status line and version stable.
      this.lastLines.set(agentId, line);
      this.version++;

      // Update the in-flight agent entry with the last stream line
      const existing = this.agents.get(agentId);
      if (existing && (existing.status === "started" || existing.status === "running")) {
        this.agents.set(agentId, {
          ...existing,
          lastStreamLine: line,
        });
      }
    }

    if (this.streamDir) {
      this.persistStreamEvent(agentId, event, line);
    }

    // Append the raw event to the in-memory buffer (capped FIFO sliding window).
    const events = this.agentEvents.get(agentId) ?? [];
    events.push(event);
    if (events.length > MAX_AGENT_EVENTS) {
      const removeCount = events.length - MAX_AGENT_EVENTS;
      events.splice(0, removeCount);
    }
    this.agentEvents.set(agentId, events);

    // Extract AgentMessage from the event and update the messages list.
    this.appendMessageFromEvent(agentId, event);
  }

  /**
   * Append a lifecycle marker to the agent's journal.
   *
   * No-op when no stream directory is configured OR journaling is disabled
   * (display-only state) - either way there is no journal to write. Never
   * throws: journal appends are best-effort internally.
   *
   * @param agentId - The agent whose journal receives the entry.
   * @param phase - Lifecycle phase of the agent run.
   * @param passed - Whether the run passed (terminal phases only).
   * @param summary - Human-readable run summary.
   */
  appendLifecycle(
    agentId: string,
    phase: "started" | "done" | "error" | "cancelled",
    passed?: boolean,
    summary?: string,
  ): void {
    // No-op when no stream directory is configured OR journaling is disabled
    // (display-only state) - with persistence off there is no journal to write.
    if (!this.streamDir || !this.journaling) return;
    // Type-level guarantees hold at compile time; a runtime guard keeps
    // malformed input from ever reaching the journal (best-effort, no-op
    // rather than throw).
    if (phase !== "started" && phase !== "done" && phase !== "error" && phase !== "cancelled") {
      return;
    }
    if (passed !== undefined && typeof passed !== "boolean") return;
    if (summary !== undefined && typeof summary !== "string") return;
    const entry: AgentJournalEntry = {
      type: "lifecycle",
      phase,
      passed,
      summary,
      ts: new Date().toISOString(),
    };
    this.journalFor(agentId)?.append(entry);
  }

  /**
   * Get (and lazily build) the append-only journal for an agent.
   *
   * Journals only exist when a stream directory is configured. The journal
   * instance is cached per agent for the lifetime of the state so every
   * event appends to the same file. Failures inside append are handled
   * there (best-effort, never throws).
   */
  private journalFor(agentId: string): AgentJournal | undefined {
    if (!this.streamDir) return undefined;
    const existing = this.journals.get(agentId);
    if (existing) return existing;
    const journal = AgentJournal.forAgent(this.streamDir, agentId, this.journalRetention);
    this.journals.set(agentId, journal);
    return journal;
  }

  /**
   * Persist stream event to the agent journal.
   *
   * Best-effort: filesystem failures are logged and swallowed so a broken
   * stream directory never interrupts the agent run.
   */
  private persistStreamEvent(agentId: string, event: JsonAgentSessionEvent, line: string): void {
    if (!this.streamDir) return;

    try {
      // journaling gates the disk-write half of this method (directory
      // creation, journal instance, and every append). A display-only state
      // (journaling=false) with a configured streamDir still runs the
      // in-memory bookkeeping below so live tool entries keep the tool cache
      // populated, but never creates or appends journal files - the journal
      // recorder owns disk writes.
      if (this.journaling) {
        mkdirSync(this.streamDir, { recursive: true });
      }
      const journal = this.journaling ? this.journalFor(agentId) : undefined;

      const ts = new Date().toISOString();

      // Persist the formatted line as a stream entry (gated by the same
      // filter that decided .stream persistence before).
      if (journal && this.shouldPersistStreamEntry(event, line)) {
        journal.append({ type: "stream", line, ts });
      }

      switch (event.type) {
        case "tool_execution_start": {
          // Remember args so the end event can replay a merged tool entry.
          const argsByTool = this.toolStartArgs.get(agentId) ?? new Map<string, unknown>();
          argsByTool.set(event.toolCallId, event.args);
          this.toolStartArgs.set(agentId, argsByTool);
          if (journal) {
            journal.append({
              type: "tool",
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.args,
              ts,
            });
          }
          this.pushAgentTool(agentId, {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            ts,
            ...(event.args !== undefined ? { args: event.args } : {}),
          });
          break;
        }
        case "tool_execution_end": {
          const argsByTool = this.toolStartArgs.get(agentId);
          const args = argsByTool?.get(event.toolCallId);
          if (journal) {
            journal.append({
              type: "tool",
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              result: event.result,
              // isError rides along only when defined - the same conditional
              // shape replay produces, so live and replayed journal entries
              // are structurally identical.
              ...(event.isError !== undefined ? { isError: event.isError } : {}),
              args,
              ts,
            });
          }
          this.pushAgentTool(agentId, {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            ts,
            ...(event.result !== undefined ? { result: event.result } : {}),
            ...(event.isError !== undefined ? { isError: event.isError } : {}),
            // args ride along only when a matching start recorded them - the
            // same conditional shape replay produces, so live and replayed
            // tool logs are structurally identical.
            ...(args !== undefined ? { args } : {}),
          });
          // Prune the remembered start args now that the end entry has
          // consumed them - bounded memory: one slot per in-flight call.
          argsByTool?.delete(event.toolCallId);
          break;
        }
        case "message_end": {
          const message = event.message;
          const role = message?.role;
          if (role === "user" || role === "assistant" || role === "toolResult") {
            journal?.append({ type: "message", message, ts });
          }
          break;
        }
        default:
          break;
      }
    } catch (err) {
      logger.warn("persistStreamEvent: failed to persist stream event", {
        agentId,
        error: String(err),
      });
    }
  }

  /**
   * Append a tool log entry to the agent's live tool cache.
   *
   * Kept in sync with the journal's {@code tool} records (same events, same
   * merged args) and capped with the same FIFO sliding window as the other
   * in-memory buffers.
   */
  private pushAgentTool(agentId: string, tool: AgentToolEntry): void {
    const tools = this.agentTools.get(agentId) ?? [];
    tools.push(tool);
    if (tools.length > MAX_AGENT_EVENTS) {
      tools.splice(0, tools.length - MAX_AGENT_EVENTS);
    }
    this.agentTools.set(agentId, tools);
  }

  /**
   * Determine whether an event should be persisted as a stream journal entry.
   *
   * Excludes noisy incremental events (message_update) and lifecycle markers
   * (turn_start, turn_end) whose content arrives through other events.
   * Also excludes message_end events that produced no extracted text.
   */
  private shouldPersistStreamEntry(event: JsonAgentSessionEvent, line: string): boolean {
    switch (event.type) {
      case "message_update":
      case "turn_start":
      case "turn_end":
        return false;
      case "message_end":
        return line !== "message_end";
      default:
        return true;
    }
  }

  /**
   * Extract AgentMessage from the event and update the messages list.
   *
   * Handles deduplication for message_update and message_end events by
   * replacing the last entry (the entry pushed by the matching message_start).
   * Applies the same FIFO sliding window cap as agentEvents to prevent
   * unbounded memory growth.
   */
  private appendMessageFromEvent(agentId: string, event: JsonAgentSessionEvent): void {
    const message = this.extractMessageFromEvent(event);
    if (!message) return;

    const messages = this.agentMessages.get(agentId) ?? [];
    if (event.type === "message_end") {
      if (messages.length > 0) {
        messages[messages.length - 1] = message;
      } else {
        messages.push(message);
      }
    } else {
      messages.push(message);
    }

    // Apply FIFO cap.
    if (messages.length > MAX_AGENT_EVENTS) {
      messages.splice(0, messages.length - MAX_AGENT_EVENTS);
    }
    this.agentMessages.set(agentId, messages);
  }

  /**
   * Extract an AgentMessage from an event if it carries one.
   *
   * Only message_start and message_end carry a message directly — the RPC
   * wire's message_update carries deltas only, so the conversation updates
   * at message_end (the authoritative message).
   */
  private extractMessageFromEvent(event: JsonAgentSessionEvent): AgentMessage | undefined {
    switch (event.type) {
      case "message_start":
      case "message_end":
        return event.message;
      default:
        return undefined;
    }
  }

  /**
   * Load the formatted stream lines for an agent from its journal.
   *
   * Replays the journal and returns its {@code stream} entries' lines in
   * order (the journal replaced the legacy .stream file as the persistence
   * source). Empty for unknown agents or when no stream directory is set.
   */
  async loadStreamFile(agentId: string): Promise<string[]> {
    const journal = this.journalFor(agentId);
    if (!journal || !existsSync(journal.filePath)) return [];

    try {
      const { entries } = await journal.read();
      return entries
        .filter((e): e is Extract<AgentJournalEntry, { type: "stream" }> => e.type === "stream")
        .map((e) => e.line);
    } catch (err) {
      logger.warn("loadStreamFile: failed to load stream file", { agentId, error: String(err) });
      return [];
    }
  }

  /**
   * Load the persisted {@link AgentMessage} objects for an agent from its
   * journal.
   *
   * Replays the journal and returns its {@code message} entries in order
   * (the journal replaced the legacy .messages.jsonl file as the
   * persistence source). Empty for unknown agents or when no stream
   * directory is set.
   */
  async loadMessagesFile(agentId: string): Promise<AgentMessage[]> {
    const journal = this.journalFor(agentId);
    if (!journal || !existsSync(journal.filePath)) return [];

    try {
      const { entries } = await journal.read();
      return entries
        .filter((e): e is Extract<AgentJournalEntry, { type: "message" }> => e.type === "message")
        .map((e) => e.message);
    } catch (err) {
      logger.warn("loadMessagesFile: failed to load messages file", {
        agentId,
        error: String(err),
      });
      return [];
    }
  }

  /**
   * Return the raw stream events for an agent (alias for getAgentEvents).
   */
  getConversation(agentId: string): JsonAgentSessionEvent[] {
    return this.getAgentEvents(agentId);
  }

  /**
   * Return the cached AgentMessage objects for an agent (alias for getAgentMessages).
   */
  getConversationMessages(agentId: string): AgentMessage[] {
    return this.getAgentMessages(agentId);
  }

  /**
   * Return the most recently recorded stream line across all agents.
   */
  get lastStreamLine(): string {
    const values = Array.from(this.lastLines.values());
    return values.length > 0 ? values[values.length - 1] : "";
  }

  /**
   * Scan the stream directory and replay persisted agent journals into
   * viewer state.
   *
   * Journal-first: agents with a {@code {agentId}.journal.jsonl} file - or
   * its rotated {@code .N} segments - are replayed directly. Agents with
   * only legacy files (.stream,
   * .messages.jsonl, .events*.jsonl) are first folded into a journal via
   * {@link AgentJournal.migrateLegacy} (one-shot; the legacy files are
   * removed on success) and then replayed. Raw {@code .events*.jsonl}
   * siblings — current plus rotated archives — are all collected so
   * migrateLegacy can order them by file mtime.
   *
   * Replay of journal files is read-only - it never appends to an existing
   * journal. The legacy fold (migrateLegacy) is the one write: it creates
   * the journal one-shot and removes the legacy files, and stays ungated by
   * the journaling switch so display replay always folds legacy agents.
   * Returns a promise that resolves when every journal has been replayed
   * (best-effort - a failing journal is logged and skipped, never thrown).
   */
  async prepopulateStreamFiles(streamDir: string): Promise<void> {
    if (streamDir !== this.streamDir) {
      // Same directory-binding rule as setStreamDir: journals cached under a
      // different directory must not serve appends for this one.
      this.journals.clear();
    }
    this.streamDir = streamDir;

    const journaled = new Set<string>();
    const legacy = new Map<string, { stream?: string; messages?: string; events: string[] }>();

    // Journal files may be segmented: the base `{agentId}.journal.jsonl`
    // plus rotated `{agentId}.journal.jsonl.N` segments. All forms map to
    // the same agent id (AgentJournal.read enumerates the segments itself),
    // so the discovery set is keyed by agentId, not by file name.
    const journalName = /^(.+)\.journal\.jsonl(?:\.\d+)?$/;

    try {
      for (const entry of readdirSync(streamDir)) {
        const journalMatch = journalName.exec(entry);
        if (journalMatch) {
          journaled.add(journalMatch[1]);
          continue;
        }
        if (entry.endsWith(".stream")) {
          const agentId = entry.slice(0, -".stream".length);
          const files = legacy.get(agentId) ?? { events: [] };
          files.stream = join(streamDir, entry);
          legacy.set(agentId, files);
          continue;
        }
        if (entry.endsWith(".messages.jsonl")) {
          const agentId = entry.slice(0, -".messages.jsonl".length);
          const files = legacy.get(agentId) ?? { events: [] };
          files.messages = join(streamDir, entry);
          legacy.set(agentId, files);
          continue;
        }
        const eventsMatch = /^(.*)\.events(?:\.\d+)?\.jsonl$/.exec(entry);
        if (eventsMatch) {
          const agentId = eventsMatch[1];
          const files = legacy.get(agentId) ?? { events: [] };
          files.events.push(join(streamDir, entry));
          legacy.set(agentId, files);
        }
      }
    } catch (err) {
      logger.warn("prepopulateStreamFiles: failed to scan stream directory", {
        error: String(err),
      });
      return;
    }

    const jobs: Promise<void>[] = [];

    // A journal's presence wins over legacy siblings (partial-migration
    // state): journaled agents are replayed directly and their leftover
    // legacy files are ignored.
    for (const agentId of journaled) {
      jobs.push(this.replayJournal(agentId));
    }

    // Legacy-only agents: fold the per-agent files into a journal (one-shot;
    // migrateLegacy derives file order by mtime, including rotated .events.*
    // archives) and replay the result.
    for (const [agentId, files] of legacy) {
      if (journaled.has(agentId)) continue;
      const journal = AgentJournal.forAgent(streamDir, agentId, this.journalRetention);
      jobs.push(
        journal
          .migrateLegacy({ stream: files.stream, messages: files.messages, events: files.events })
          .then(() => this.replayJournal(agentId)),
      );
    }

    // Preserve the fire-and-forget contract: prepopulate resolves when all
    // replays settle, and a failing journal never rejects the caller.
    await Promise.allSettled(jobs);
  }

  /**
   * Replay one agent's journal into viewer state.
   *
   * Lifecycle handling: the FIRST {@code started} entry's ts seeds createdAt
   * and the LAST lifecycle entry wins for status — a trailing {@code done}/
   * {@code error}/{@code cancelled} terminal determines status, passed,
   * summary, and finishedAt, while a trailing {@code started} means a newer
   * run is in flight (an earlier terminal must not relabel it) and leaves
   * the entry "running" with no finishedAt. Replay reports history
   * truthfully, it never invents a terminal state.
   *
   * Entry creation is guarded: an agent with an existing entry (live-seeded
   * via connect's agentQuery or the pre-connect buffer) is the current truth
   * and is never overwritten with a journal terminal from a prior run. The
   * derived caches (messages, tools, last stream line) are populated
   * regardless, so a live entry still gets its historical data.
   *
   * A journal that could not be read to EOF is still replayed from the
   * partial entries (tolerated, warn logged). Agents with an empty journal
   * get no entry.
   */
  private async replayJournal(agentId: string): Promise<void> {
    const journal = this.journalFor(agentId);
    if (!journal) return;
    if (!existsSync(journal.filePath)) return;

    const { entries, complete } = await journal.read();
    if (!complete) {
      logger.warn("prepopulateStreamFiles: journal read incomplete", { agentId });
    }

    let firstStartedAt: Date | undefined;
    let lastLifecycle: Extract<AgentJournalEntry, { type: "lifecycle" }> | undefined;
    const messages: AgentMessage[] = [];
    const tools: AgentToolEntry[] = [];
    let lastStreamLine: string | undefined;

    for (const entry of entries) {
      switch (entry.type) {
        case "lifecycle":
          if (entry.phase === "started") {
            const startedAt = AgentViewerState.parseEntryTs(entry.ts);
            if (startedAt) firstStartedAt ??= startedAt;
          }
          // Last lifecycle entry wins: started -> done -> started means run 2
          // is in flight, so the done terminal must not relabel it.
          lastLifecycle = entry;
          break;
        case "message":
          messages.push(entry.message);
          break;
        case "stream":
          lastStreamLine = entry.line;
          break;
        case "tool":
          tools.push({
            toolCallId: entry.toolCallId,
            toolName: entry.toolName,
            ts: entry.ts,
            ...(entry.args !== undefined ? { args: entry.args } : {}),
            ...(entry.result !== undefined ? { result: entry.result } : {}),
            ...(entry.isError !== undefined ? { isError: entry.isError } : {}),
          });
          break;
        case "forge":
          // Replay-ignored: forge entries carry future loop/workspace/session
          // context; no view renders them yet (see AgentJournalEntry).
          break;
      }
    }

    if (entries.length === 0) return;

    let status: AgentViewerEntryStatus = "running";
    let passed: boolean | undefined;
    let summary: string | undefined;
    let finishedAt: Date | undefined;
    const terminal = lastLifecycle && lastLifecycle.phase !== "started" ? lastLifecycle : undefined;
    if (terminal) {
      status = terminal.phase;
      passed = terminal.passed;
      summary = terminal.summary;
      finishedAt = AgentViewerState.parseEntryTs(terminal.ts);
    }

    let createdAt: Date;
    if (firstStartedAt) {
      createdAt = firstStartedAt;
    } else {
      // No started lifecycle (e.g. a migrated legacy journal): the earliest
      // valid entry ts is the best creation stamp we have. Fall back to the
      // journal file's birthtime — some filesystems report no birthtime
      // (epoch 0), treated as absent.
      createdAt =
        entries.reduce<Date | undefined>((earliest, entry) => {
          const ts = AgentViewerState.parseEntryTs(entry.ts);
          if (!ts) return earliest;
          return !earliest || ts.getTime() < earliest.getTime() ? ts : earliest;
        }, undefined) ?? AgentViewerState.journalBirthtime(journal.filePath);
    }

    // Replayed caches carry the same FIFO cap as their live counterparts.
    if (messages.length > 0) {
      this.agentMessages.set(
        agentId,
        messages.length > MAX_AGENT_EVENTS ? messages.slice(-MAX_AGENT_EVENTS) : messages,
      );
    }
    if (tools.length > 0) {
      this.agentTools.set(
        agentId,
        tools.length > MAX_AGENT_EVENTS ? tools.slice(-MAX_AGENT_EVENTS) : tools,
      );
    }
    if (lastStreamLine !== undefined) {
      this.lastLines.set(agentId, lastStreamLine);
    }

    // No-overwrite guard (restores the pre-journal ensureStaleEntry
    // contract): an entry already present was live-seeded by connect's
    // agentQuery or the pre-connect buffer and reflects the current session.
    // Overwriting it with a journal terminal from a prior run of the same
    // agent id would relabel a live started/running agent as done/error with
    // stale summary and timestamps. Caches above are still populated.
    if (this.agents.has(agentId)) return;

    if (status === "done") {
      this.update({
        id: agentId,
        status: "done",
        createdAt,
        ...(finishedAt !== undefined ? { finishedAt } : {}),
        // passed stays undefined when the journal carries no pass/fail — the
        // entry then renders "completed" (green), never "failed".
        ...(passed !== undefined ? { passed } : {}),
        summary: summary ?? "",
      });
      return;
    }
    if (status === "error") {
      this.update({
        id: agentId,
        status: "error",
        createdAt,
        ...(finishedAt !== undefined ? { finishedAt } : {}),
        ...(summary !== undefined ? { summary } : {}),
        errorMessage: summary ?? "Agent failed",
      });
      return;
    }
    if (status === "cancelled") {
      this.update({
        id: agentId,
        status: "cancelled",
        createdAt,
        ...(finishedAt !== undefined ? { finishedAt } : {}),
        ...(summary !== undefined ? { summary } : {}),
      });
      return;
    }

    // started/running: the replayed run is in flight — no finishedAt, the
    // last stream line rides on the entry for the list view.
    this.update({
      id: agentId,
      status: "running",
      createdAt,
      ...(lastStreamLine !== undefined ? { lastStreamLine } : {}),
    });
  }

  /**
   * Parse an ISO timestamp from a journal entry, tolerating invalid values.
   *
   * Journal lines are the writer's own output, but a corrupted or
   * hand-edited line can carry an unparseable ts. Returns undefined for
   * invalid stamps so callers can fall back instead of deriving a
   * NaN-based date (which would render as "Invalid Date").
   */
  private static parseEntryTs(ts: string): Date | undefined {
    const date = new Date(ts);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  /**
   * Best-effort creation stamp from the journal file's birthtime.
   *
   * Some filesystems report no birthtime (epoch 0) — treated as absent, in
   * which case "now" is used so replay never produces an invalid date.
   */
  private static journalBirthtime(filePath: string): Date {
    try {
      const birthtime = statSync(filePath).birthtime;
      return birthtime.getTime() > 0 ? birthtime : new Date();
    } catch {
      return new Date();
    }
  }

  /**
   * Return the most recent raw stream events for an agent.
   *
   * The in-memory sliding window is the only source — raw events are no
   * longer persisted to disk, so there is no disk history to load beyond
   * the window.
   *
   * @param agentId - The agent to get events for.
   * @param count - Maximum number of events to return (most recent wins).
   * @returns An array of events in insertion order, most recent last.
   */
  async loadConversationEvents(
    agentId: string,
    count: number = MAX_AGENT_EVENTS,
  ): Promise<JsonAgentSessionEvent[]> {
    const memoryEvents = this.agentEvents.get(agentId) ?? [];
    return memoryEvents.slice(-count);
  }
}
