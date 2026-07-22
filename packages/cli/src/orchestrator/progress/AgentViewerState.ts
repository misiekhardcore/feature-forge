import { appendFileSync, createReadStream, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import { jsonParse } from "@feature-forge/shared";

import { logger } from "../../logging";
import type { AgentViewerEntry } from "@feature-forge/tui";

/**
 * Maximum raw events kept in memory per agent (sliding window FIFO).
 * Older events are evicted but persist on disk via JSONL for lazy loading.
 */
const MAX_AGENT_EVENTS = 200;

/**
 * Pure logic class managing agent viewer state.
 *
 * Handles:
 * - Map of agent entries
 * - Streaming event buffers
 * - Filesystem persistence (.stream, .events.jsonl, .messages.jsonl)
 * - Zero TUI dependencies
 */
export class AgentViewerState {
  /** Maps agent id → agent entry. */
  private agents = new Map<string, AgentViewerEntry>();

  /** Maps agent id → most recent formatted stream line. */
  private lastLines = new Map<string, string>();

  /** Maps agent id → stream file path on disk. */
  private streamFiles = new Map<string, string>();

  /** Maps agent id → events JSONL file path on disk (raw events, diagnostics only). */
  private eventsFiles = new Map<string, string>();

  /** Maps agent id → messages JSONL file path on disk (finalized messages). */
  private messagesFiles = new Map<string, string>();

  /** Directory used for filesystem-backed stream buffers. */
  private streamDir?: string;

  /** Maps agent id → raw stream events in insertion order. */
  private agentEvents = new Map<string, AgentEvent[]>();

  /** Maps agent id → extracted AgentMessage objects in order. */
  private agentMessages = new Map<string, AgentMessage[]>();

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
   * Get the last formatted stream line for an agent.
   */
  getLastLine(agentId: string): string | undefined {
    return this.lastLines.get(agentId);
  }

  /**
   * Get raw stream events for an agent from the in-memory buffer.
   *
   * Returns events currently held in the sliding window (up to
   * {@link MAX_AGENT_EVENTS} per agent). Use {@link loadConversationEvents}
   * for disk-backed history beyond the window.
   *
   * @param agentId - The agent to get events for.
   * @returns An array of events in insertion order, most recent last. Empty for unknown agents.
   */
  getAgentEvents(agentId: string): AgentEvent[] {
    return this.agentEvents.get(agentId) ?? [];
  }

  /**
   * Get cached {@link AgentMessage} objects for an agent in order.
   *
   * Messages are populated live from {@link pushStreamEvent} on each
   * {@code message_end} event and loaded from {@code messages.jsonl} on
   * startup via {@link prepopulateStreamFiles}.
   *
   * @param agentId - The agent to get messages for.
   * @returns An array of messages, most recent last. Empty for unknown agents.
   */
  getAgentMessages(agentId: string): AgentMessage[] {
    return this.agentMessages.get(agentId) ?? [];
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
   * When set, every pushStreamEvent call persists the formatted
   * event line to an append-only log file named
   * `{agentId}.stream` under the given directory.
   *
   * @param streamDir — Directory for filesystem-backed stream buffers.
   */
  setStreamDir(streamDir: string): void {
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
   * Push or update a single agent entry.
   *
   * Later calls for the same agent id merge with and overwrite prior state
   * so the viewer always reflects the most recent lifecycle status.
   */
  update(entry: AgentViewerEntry): void {
    const existing = this.agents.get(entry.id);
    this.agents.set(entry.id, { ...existing, ...entry });
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
   * Dispose of all state including filesystem handles.
   */
  dispose(): void {
    this.agents.clear();
    this.lastLines.clear();
    this.agentEvents.clear();
    this.agentMessages.clear();
    this.streamFiles.clear();
    this.eventsFiles.clear();
    this.messagesFiles.clear();
    this.streamDir = undefined;
  }

  /**
   * Push a streaming event for an agent.
   *
   * Formats the event into a human-readable line (kept in memory as the
   * most recent stream line) and, when streamDir is
   * configured, appends it to a per-agent log file on disk.
   */
  pushStreamEvent(
    agentId: string,
    event: AgentEvent,
    formatEvent: (e: AgentEvent) => string,
  ): void {
    if (!this.agents.has(agentId)) {
      this.update({
        id: agentId,
        status: "started",
        createdAt: new Date(),
      });
    }

    const line = formatEvent(event);
    this.lastLines.set(agentId, line);

    // Update the running agent entry with the last stream line
    const existing = this.agents.get(agentId);
    if (existing && existing.status === "started") {
      this.agents.set(agentId, {
        ...existing,
        lastStreamLine: line,
      });
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
   * Persist stream event to disk.
   */
  private persistStreamEvent(agentId: string, event: AgentEvent, line: string): void {
    if (!this.streamDir) return;

    try {
      mkdirSync(this.streamDir, { recursive: true });

      // Persist formatted line to .stream file (sync, small writes).
      if (this.shouldPersistToStreamFile(event, line)) {
        const streamPath =
          this.streamFiles.get(agentId) ?? join(this.streamDir, `${agentId}.stream`);
        if (!this.streamFiles.has(agentId)) {
          this.streamFiles.set(agentId, streamPath);
        }
        appendFileSync(streamPath, `${line}\n`, "utf-8");
      }

      // Persist raw event to .events.jsonl (sync, small writes).
      const eventsPath =
        this.eventsFiles.get(agentId) ?? join(this.streamDir, `${agentId}.events.jsonl`);
      if (!this.eventsFiles.has(agentId)) {
        this.eventsFiles.set(agentId, eventsPath);
      }
      appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, "utf-8");

      // Persist finalized message to .messages.jsonl (sync, small writes).
      // Only message_end events for user/assistant/toolResult carry a
      // finalized message.
      if (event.type === "message_end" && event.message) {
        const message = event.message;
        const role = message.role;
        if (role === "user" || role === "assistant" || role === "toolResult") {
          const messagesPath =
            this.messagesFiles.get(agentId) ?? join(this.streamDir, `${agentId}.messages.jsonl`);
          if (!this.messagesFiles.has(agentId)) {
            this.messagesFiles.set(agentId, messagesPath);
          }
          appendFileSync(messagesPath, `${JSON.stringify(message)}\n`, "utf-8");
        }
      }
    } catch (err) {
      logger.warn("persistStreamEvent: failed to persist stream event", {
        agentId,
        error: String(err),
      });
    }
  }

  /**
   * Determine whether an event should be persisted to the .stream file.
   *
   * Excludes noisy incremental events (message_update) and lifecycle markers
   * (turn_start, turn_end) whose content arrives through other events.
   * Also excludes message_end events that produced no extracted text.
   */
  private shouldPersistToStreamFile(event: AgentEvent, line: string): boolean {
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
  private appendMessageFromEvent(agentId: string, event: AgentEvent): void {
    const message = AgentViewerState.extractMessageFromEvent(event);
    if (!message) return;

    const messages = this.agentMessages.get(agentId) ?? [];
    if (event.type === "message_update" || event.type === "message_end") {
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
   * Returns the message for message_start, message_update, and
   * message_end events. Returns undefined for all other event types.
   */
  static extractMessageFromEvent(event: AgentEvent): AgentMessage | undefined {
    switch (event.type) {
      case "message_start":
      case "message_update":
      case "message_end":
        return event.message;
      default:
        return undefined;
    }
  }

  /**
   * Load persisted stream events from disk for an agent.
   * Returns lines from the .stream file.
   */
  async loadStreamFile(agentId: string): Promise<string[]> {
    const streamPath = this.streamFiles.get(agentId);
    if (!streamPath) return [];

    try {
      const lines: string[] = [];
      const fileStream = createInterface({
        input: createReadStream(streamPath, "utf-8"),
      });

      for await (const line of fileStream) {
        lines.push(line);
      }

      return lines;
    } catch (err) {
      logger.warn("loadStreamFile: failed to load stream file", { agentId, error: String(err) });
      return [];
    }
  }

  /**
   * Load persisted messages from disk for an agent.
   */
  async loadMessagesFile(agentId: string): Promise<AgentMessage[]> {
    const messagesPath = this.messagesFiles.get(agentId);
    if (!messagesPath) return [];

    try {
      const messages: AgentMessage[] = [];
      const fileStream = createInterface({
        input: createReadStream(messagesPath, "utf-8"),
      });

      for await (const line of fileStream) {
        messages.push(JSON.parse(line) as AgentMessage);
      }

      return messages;
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
  getConversation(agentId: string): AgentEvent[] {
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
   * Scan the stream directory for existing per-agent files and pre-populate
   * state. Creates stale entries for agents with files but no entry,
   * and loads messages from .messages.jsonl files into the cache.
   *
   * Returns a promise that resolves when all message files have been
   * fully streamed into the cache.
   */
  async prepopulateStreamFiles(streamDir: string): Promise<void> {
    const ensureStaleEntry = (agentId: string): void => {
      if (this.agents.has(agentId)) return;
      this.update({
        id: agentId,
        status: "done",
        createdAt: new Date(),
        passed: false,
        summary: "Agent completed",
      });
    };

    const loadPromises: Promise<void>[] = [];

    try {
      for (const entry of readdirSync(streamDir)) {
        if (entry.endsWith(".stream")) {
          const agentId = entry.slice(0, -".stream".length);
          this.streamFiles.set(agentId, join(streamDir, entry));
          ensureStaleEntry(agentId);
          continue;
        }

        if (entry.endsWith(".messages.jsonl")) {
          const agentId = entry.slice(0, -".messages.jsonl".length);
          const filePath = join(streamDir, entry);
          this.messagesFiles.set(agentId, filePath);
          ensureStaleEntry(agentId);
          loadPromises.push(this.loadMessagesFromDiskIntoCache(agentId, filePath));
          continue;
        }

        if (entry.endsWith(".events.jsonl")) {
          const agentId = entry.slice(0, -".events.jsonl".length);
          const filePath = join(streamDir, entry);
          this.eventsFiles.set(agentId, filePath);
          ensureStaleEntry(agentId);
          continue;
        }
      }
    } catch (err) {
      logger.warn("prepopulateStreamFiles: failed to scan stream directory", {
        error: String(err),
      });
    }

    await Promise.allSettled(loadPromises);
  }

  /**
   * Load conversation events from the on-disk JSONL file for the given agent.
   */
  async loadConversationEvents(
    agentId: string,
    count: number = MAX_AGENT_EVENTS,
  ): Promise<AgentEvent[]> {
    const memoryEvents = this.agentEvents.get(agentId) ?? [];

    if (count <= memoryEvents.length) {
      return memoryEvents.slice(-count);
    }

    const eventsPath = this.eventsFiles.get(agentId);
    if (!eventsPath) {
      return memoryEvents.slice(-count);
    }

    try {
      const lines: string[] = [];
      const rl = createInterface({
        input: createReadStream(eventsPath, "utf-8"),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line) continue;
        lines.push(line);
        if (lines.length > count) {
          lines.shift();
        }
      }

      const diskEvents: AgentEvent[] = [];
      for (const line of lines) {
        try {
          const parsed = jsonParse<AgentEvent>(line);
          diskEvents.push(parsed);
        } catch (err) {
          logger.warn("loadConversationEvents: failed to parse event line", {
            agentId,
            error: String(err),
          });
        }
      }

      return diskEvents;
    } catch (err) {
      logger.warn("loadConversationEvents: failed to load events file", {
        agentId,
        error: String(err),
      });
      return memoryEvents.slice(-count);
    }
  }

  /**
   * Parse a .messages.jsonl file into cached agentMessages using streaming reads.
   *
   * Streams the file line-by-line via {@code createReadStream} +
   * {@code createInterface}, avoiding loading the entire file into memory.
   * Invalid JSON lines are silently skipped. Parsed messages are prepended
   * to the in-memory cache (disk content precedes live content).
   */
  private async loadMessagesFromDiskIntoCache(agentId: string, filePath: string): Promise<void> {
    try {
      const disk: AgentMessage[] = [];
      const rl = createInterface({
        input: createReadStream(filePath, "utf-8"),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (!line) continue;
        try {
          const parsed = jsonParse<AgentMessage>(line);
          disk.push(parsed);
        } catch (err) {
          logger.warn("loadMessagesFromDiskIntoCache: failed to parse message line", {
            agentId,
            error: String(err),
          });
        }
      }

      if (disk.length === 0) return;
      const existing = this.agentMessages.get(agentId) ?? [];
      const merged = [...disk, ...existing];
      if (merged.length > MAX_AGENT_EVENTS) {
        merged.splice(0, merged.length - MAX_AGENT_EVENTS);
      }
      this.agentMessages.set(agentId, merged);
    } catch (err) {
      logger.warn("loadMessagesFromDiskIntoCache: failed to load messages from disk", {
        agentId,
        error: String(err),
      });
    }
  }
}
