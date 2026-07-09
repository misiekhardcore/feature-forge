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
    { name: string; status: "running" | "ok" | "error"; result: string }
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
      this.pendingToolCalls.set(agentId, { name: toolName, status: "running", result: "" });
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
