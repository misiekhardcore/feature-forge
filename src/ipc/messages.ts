/**
 * Type definitions for the Unix socket IPC protocol between parent and child agents.
 *
 * Protocol summary:
 * - Client sends a `SocketMessage` with a unique `correlationId`.
 * - Server responds with a `SocketResponse` carrying the same `correlationId`.
 * - Server may also push unsolicited `SocketPush` events (e.g., agent status updates).
 */

import type { AgentStatus } from "../agents";

// ─── Requests ──────────────────────────────────────────────────────────────

/**
 * Parameters for spawning an agent via IPC.
 *
 * All values are fully resolved before they reach the IPC layer — no template
 * variables, no spec name lookups. The parent creates the agent specification
 * directly from these fields.
 */
export interface SpawnAgentParams {
  /** Display label / role name for the spawned agent. */
  label: string;
  /** Resolved persona text sent as the system prompt. */
  systemPrompt: string;
  /** Optional initial task the agent should execute immediately. */
  prompt?: string;
  /** Tool names to grant the agent. */
  tools: readonly string[];
  /** Optional model preference (e.g. "claude-sonnet-4-5"). */
  model?: string;
  /** Optional working directory. */
  cwd?: string;
}

export interface SendTaskParams {
  /** Target agent's id string. */
  agentId: string;
  /** The task message to send. */
  prompt: string;
  /**
   * If true, block the socket response until the agent completes.
   * If false, respond immediately and push an `agent_update` event later.
   */
  await: boolean;
  /**
   * Optional timeout in milliseconds for this specific dispatch.
   * Overrides the default IPC and agent-execution timeouts when set.
   */
  timeout?: number;
}
export interface GetAgentResultParams {
  /** Target agent's id string. */
  agentId: string;
}
/** Parameters for list_agents — intentionally empty (all agents are returned). */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ListAgentsParams {}
export interface DestroyAgentParams {
  /** Target agent's id string. */
  agentId: string;
}

// Request messages
export type SpawnSocketMessage = {
  type: "spawn_agent";
  correlationId: string;
  params: SpawnAgentParams;
};
export type SendTaskSocketMessage = {
  type: "send_task";
  correlationId: string;
  params: SendTaskParams;
};
export type GetAgentResultSocketMessage = {
  type: "get_agent_result";
  correlationId: string;
  params: GetAgentResultParams;
};
export type ListAgentsSocketMessage = {
  type: "list_agents";
  correlationId: string;
  params?: ListAgentsParams;
};
export type DestroyAgentSocketMessage = {
  type: "destroy_agent";
  correlationId: string;
  params: DestroyAgentParams;
};

/**
 * Every request message type.
 */
export type SocketMessage =
  | SpawnSocketMessage
  | SendTaskSocketMessage
  | GetAgentResultSocketMessage
  | ListAgentsSocketMessage
  | DestroyAgentSocketMessage;

// ─── Responses ─────────────────────────────────────────────────────────────

export type SpawnAgentResult = {
  agentId: string;
  label: string;
};
export type SendTaskResult = { result: string | null } | { status: "dispatched" };
export type GetAgentResultResult = {
  status: string;
  result: string | null;
};
export type ListAgentsResult = {
  agents: { agentId: string; role: string; status: string }[];
};
export type DestroyAgentResult = {
  status: "destroyed";
};

export type SocketResponseResult = {
  type: "result";
  correlationId: string;
  result:
    | SpawnAgentResult
    | SendTaskResult
    | GetAgentResultResult
    | ListAgentsResult
    | DestroyAgentResult;
};
export type SocketResponseError = {
  type: "error";
  correlationId: string;
  error: string;
};

/**
 * A successful or failed response to a prior request.
 */
export type SocketResponse = SocketResponseResult | SocketResponseError;

export interface ParamsToResponseMap {
  spawn_agent: SpawnAgentResult;
  send_task: SendTaskResult;
  get_agent_result: GetAgentResultResult;
  list_agents: ListAgentsResult;
  destroy_agent: DestroyAgentResult;
}

// ─── Push events ───────────────────────────────────────────────────────────

/**
 * Unsolicited event pushed from server to client.
 */
export interface AgentUpdateEvent {
  /** The agent that changed. */
  agentId: string;
  /** Human-readable status label (e.g. "running", "completed", "failed"). */
  status: AgentStatus;
  /** Present only when the agent has completed its task. */
  result?: string;
}

/**
 * A push event envelope sent from server to client without a matching request.
 */
export type SocketPush = { type: "agent_update"; payload: AgentUpdateEvent };
