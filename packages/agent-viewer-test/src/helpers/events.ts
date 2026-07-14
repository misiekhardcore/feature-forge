import type { AgentEvent, AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  ToolResultMessage,
} from "@earendil-works/pi-ai/base";

// ── Agent lifecycle events ──────────────────────────────────

/** Agent run started. */
export function agentStartEvent(): AgentEvent {
  return { type: "agent_start" };
}

/** Agent run ended. */
export function agentEndEvent(messages: AgentMessage[] = []): AgentEvent {
  return { type: "agent_end", messages };
}

// ── Turn events ─────────────────────────────────────────────

/** Turn started. */
export function turnStartEvent(): AgentEvent {
  return { type: "turn_start" };
}

/** Turn ended with the final message and tool results. */
export function turnEndEvent(
  message: AssistantMessage,
  toolResults: ToolResultMessage[],
): AgentEvent {
  return { type: "turn_end", message, toolResults };
}

// ── Message events ──────────────────────────────────────────

/** Message started streaming. */
export function messageStartEvent(message: AgentMessage): AgentEvent {
  return { type: "message_start", message };
}

/** Message updated with a stream delta. */
export function messageUpdateEvent(
  message: AgentMessage,
  assistantMessageEvent: AssistantMessageEvent,
): AgentEvent {
  return { type: "message_update", message, assistantMessageEvent };
}

/** Message finished streaming. */
export function messageEndEvent(message: AgentMessage): AgentEvent {
  return { type: "message_end", message };
}

// ── Tool execution events ───────────────────────────────────

/** Tool execution started. */
export function toolExecutionStartEvent(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
): AgentEvent {
  return { type: "tool_execution_start", toolCallId, toolName, args };
}

/** Tool execution ended with a result. */
export function toolExecutionEndEvent(
  toolCallId: string,
  toolName: string,
  result: string,
  isError: boolean,
): AgentEvent {
  return { type: "tool_execution_end", toolCallId, toolName, result, isError };
}

// ── Helper: build a minimal AssistantMessageEvent for message_update ──

/** Create a minimal text_delta event for simulating streaming. */
export function textDeltaEvent(
  contentIndex: number,
  delta: string,
  partial: AssistantMessage,
): AssistantMessageEvent {
  return { type: "text_delta", contentIndex, delta, partial };
}
