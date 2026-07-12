import { readFileSync } from "node:fs";

import type { AgentEvent } from "@earendil-works/pi-agent-core";

import { extractMessageText } from "./helpers";

/**
 * A single turn in a per-agent conversation built from stream events.
 */
export interface ConversationTurn {
  type: "message" | "tool_call";
  role?: string;
  content?: string;
  toolName?: string;
  toolArgs?: string;
  toolStatus?: "running" | "ok" | "error";
  toolResult?: string;
}

/**
 * Tracks structured conversation turns per agent from stream events.
 *
 * Maintains in-progress message and tool-call state so that multi-event
 * sequences (e.g. message_start → message_update → message_end) are
 * collapsed into a single turn when finalized.
 */
export class ConversationTracker {
  private conversations = new Map<string, ConversationTurn[]>();
  private pendingMessages = new Map<string, { role: string; content: string }>();
  private pendingToolCalls = new Map<
    string,
    { name: string; args?: string; status: "running" | "ok" | "error"; result: string }
  >();

  /**
   * Build conversation turns from an incoming stream event.
   *
   * Maintains pending message / tool-call state so that multi-event
   * sequences are collapsed into a single turn when finalized.
   */
  trackTurn(agentId: string, event: AgentEvent): void {
    if (event.type === "message_start") {
      this.finalizePendingTurns(agentId);
      const role = resolveMessageRole(event.message);
      this.pendingMessages.set(agentId, { role, content: "" });
    } else if (event.type === "message_update") {
      const text = extractMessageText(event.message);
      const pending = this.pendingMessages.get(agentId);
      if (pending) {
        pending.content = text;
      }
    } else if (event.type === "message_end") {
      const text = extractMessageText(event.message);
      const pending = this.pendingMessages.get(agentId);
      if (pending) {
        pending.content = text;
      }
      this.finalizePendingTurns(agentId);
    } else if (event.type === "tool_execution_start") {
      this.finalizePendingTurns(agentId);
      const toolName =
        event.toolName && typeof event.toolName === "string" ? event.toolName : "unknown";
      const args =
        "args" in event && event.args !== undefined
          ? ConversationTracker.serializeToolArgs(event.args)
          : undefined;
      this.pendingToolCalls.set(agentId, { name: toolName, args, status: "running", result: "" });
    } else if (event.type === "tool_execution_update") {
      const pending = this.pendingToolCalls.get(agentId);
      if (pending && typeof event.partialResult === "string") {
        pending.result += event.partialResult;
      }
    } else if (event.type === "tool_execution_end") {
      const pending = this.pendingToolCalls.get(agentId);
      if (pending) {
        pending.status = event.isError === true ? "error" : "ok";
        if (typeof event.result === "string") {
          pending.result = event.result;
        }
      }
      this.finalizePendingTurns(agentId);
    }
  }

  /**
   * Return the structured conversation turns for an agent, including any
   * in-progress message or tool-call that has not yet been finalized.
   */
  getConversation(agentId: string): ConversationTurn[] {
    const turns = [...(this.conversations.get(agentId) ?? [])];

    const pendingMessage = this.pendingMessages.get(agentId);
    if (pendingMessage && pendingMessage.content.length > 0) {
      turns.push({
        type: "message" as const,
        role: pendingMessage.role,
        content: pendingMessage.content,
      });
    }

    const pendingToolCall = this.pendingToolCalls.get(agentId);
    if (pendingToolCall) {
      turns.push({
        type: "tool_call" as const,
        toolName: pendingToolCall.name,
        toolArgs: pendingToolCall.args,
        toolStatus: pendingToolCall.status,
        toolResult: pendingToolCall.result,
      });
    }

    return turns;
  }

  /** Clear all tracked conversation state. */
  clear(): void {
    this.conversations.clear();
    this.pendingMessages.clear();
    this.pendingToolCalls.clear();
  }

  /**
   * Parse the formatted .stream event lines for an agent and replay them
   * into the tracker so that {@link getConversation} returns populated turns
   * for agents whose stream files were written before the tracker existed.
   *
   * Each line is expected to be in the same format produced by
   * {@link formatStreamEvent} (e.g. `tool_execution_start: read`).
   * Lines that cannot be parsed are silently skipped.
   */
  ingestFromStream(agentId: string, filePath: string): void {
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      return;
    }
    const lines = content.split("\n").filter((l) => l.length > 0);
    for (const line of lines) {
      const event = this.parseStreamLine(line);
      if (event) {
        this.trackTurn(agentId, event);
      }
    }
  }

  /**
   * Serialize tool call arguments to a stable string representation.
   *
   * Attempts JSON serialization first; falls back to String() for
   * non-serializable values.
   */
  static serializeToolArgs(args: unknown): string {
    if (typeof args === "string") return args;
    try {
      const serialized = JSON.stringify(args, null, 2);
      if (serialized !== undefined) return serialized;
    } catch {
      // Fall through to string coercion.
    }
    return String(args);
  }

  /**
   * Reverse-parse a formatted .stream line back into an {@link AgentEvent}
   * so it can be replayed through {@link trackTurn}.
   *
   * The line format is defined by {@link formatStreamEvent}:
   *
   *   `type: detail`
   *   `tool_execution_end: <name> (ok|error)`
   *   `tool_execution_update: <name>: <result>`
   *
   * Returns `undefined` when the line does not match a known event type.
   */
  private parseStreamLine(line: string): AgentEvent | undefined {
    const colonIndex = line.indexOf(": ");
    if (colonIndex === -1) {
      // No colon-space separator — treat entire line as the event type.
      const type = line.trim();
      if (type === "agent_start") return { type: "agent_start" };
      if (type === "agent_end") return { type: "agent_end" } as AgentEvent;
      return undefined;
    }

    const eventType = line.slice(0, colonIndex);
    const detail = line.slice(colonIndex + 2);

    switch (eventType) {
      case "message_start": {
        const role = detail.length > 0 ? detail : "unknown";
        return { type: "message_start", message: { role } } as AgentEvent;
      }

      case "message_update": {
        if (detail.length === 0) return undefined;
        return {
          type: "message_update",
          message: { content: [{ type: "text", text: detail }] },
        } as AgentEvent;
      }

      case "message_end": {
        if (detail.length === 0) return undefined;
        return {
          type: "message_end",
          message: { content: [{ type: "text", text: detail }] },
        } as AgentEvent;
      }

      case "tool_execution_start": {
        // Parse format: <toolName> | <serializedArgs>
        // (backward-compatible: if no " | ", no args are reconstructed).
        const sepIndex = detail.indexOf(" | ");
        let toolName: string;
        let args: unknown;
        if (sepIndex !== -1) {
          toolName = detail.slice(0, sepIndex);
          const serializedArgs = detail.slice(sepIndex + 3);
          try {
            args = JSON.parse(serializedArgs);
          } catch {
            args = serializedArgs;
          }
        } else {
          toolName = detail;
        }
        if (toolName.length === 0) toolName = "unknown";
        const result: Record<string, unknown> = { type: "tool_execution_start", toolName };
        if (args !== undefined) {
          result.args = args;
        }
        return result as unknown as AgentEvent;
      }

      case "tool_execution_end": {
        // Format: <name> (ok) or <name> (error)
        const parenOpen = detail.lastIndexOf(" (");
        if (parenOpen === -1) {
          return { type: "tool_execution_end", toolName: detail, isError: false } as AgentEvent;
        }
        const toolName = detail.slice(0, parenOpen);
        const statusText = detail.slice(parenOpen + 2, -1); // strip parens
        const isError = statusText === "error";
        return { type: "tool_execution_end", toolName, isError } as AgentEvent;
      }

      case "tool_execution_update": {
        // Format: <name>: <partialResult>
        const sepIndex = detail.indexOf(": ");
        if (sepIndex === -1) {
          const toolName = detail;
          return { type: "tool_execution_update", toolName, partialResult: "" } as AgentEvent;
        }
        const toolName = detail.slice(0, sepIndex);
        const partialResult = detail.slice(sepIndex + 2);
        return { type: "tool_execution_update", toolName, partialResult } as AgentEvent;
      }

      default:
        return undefined;
    }
  }

  /**
   * Commit any in-progress message or tool-call into the agent's conversation.
   */
  private finalizePendingTurns(agentId: string): void {
    const turns = [...(this.conversations.get(agentId) ?? [])];

    const pendingMessage = this.pendingMessages.get(agentId);
    if (pendingMessage && pendingMessage.content.length > 0) {
      turns.push({
        type: "message" as const,
        role: pendingMessage.role,
        content: pendingMessage.content,
      });
      this.pendingMessages.delete(agentId);
    }

    const pendingToolCall = this.pendingToolCalls.get(agentId);
    if (pendingToolCall) {
      turns.push({
        type: "tool_call" as const,
        toolName: pendingToolCall.name,
        toolArgs: pendingToolCall.args,
        toolStatus: pendingToolCall.status,
        toolResult: pendingToolCall.result,
      });
      this.pendingToolCalls.delete(agentId);
    }

    this.conversations.set(agentId, turns);
  }
}

/**
 * Safely extract the role string from a message object.
 *
 * Uses a runtime type guard instead of an unsafe double-cast.
 */
function resolveMessageRole(message: unknown): string {
  if (typeof message !== "object" || message === null) return "unknown";
  const msg = message as Record<string, unknown>;
  const role = msg["role"];
  return typeof role === "string" ? role : "unknown";
}
