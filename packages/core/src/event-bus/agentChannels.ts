import type { AgentEvent } from "@earendil-works/pi-agent-core";

import type { ForgeChannels } from "./channels";

/**
 * Shared agent lifecycle emitters (D4): `feature-forge:agent-started`,
 * `feature-forge:agent-stream`, and `feature-forge:agent-done` payloads are
 * constructed ONLY here, so both emission paths — routine steps via
 * {@link AgentStepExecutor} and direct IPC tool calls via
 * {@link ParentSocketServer} — stay byte-identical.
 *
 * Minimal typed-emit contract mirroring {@link TypedEventBus.emit}: the
 * channel is narrowed to the forge channel map and the payload follows the
 * channel's declared shape. Any object exposing such an emit — including
 * pi's untyped `EventBus` — satisfies it structurally.
 */
export interface AgentChannelEmitter {
  emit<C extends keyof ForgeChannels>(channel: C, payload: ForgeChannels[C]): void;
}

/**
 * Fallback emit contract for buses that only declare a plain string/unknown
 * signature (pi's `EventBus` declares `emit(channel: string, data: unknown)`).
 * Such a signature is structurally assignable to {@link AgentChannelEmitter},
 * so the helpers accept both shapes without casts.
 */
export interface StringEmitBus {
  emit(channel: string, payload: unknown): void;
}

/** Union accepted by the agent-channel helpers below. */
export type AgentChannelEmitterLike = AgentChannelEmitter | StringEmitBus;

export interface AgentStartedParams {
  executionId: string;
  agentId: string;
  /** Name used in the human-readable message (agent id or instruction id). */
  name: string;
  /** Role/spec label shown in parentheses. */
  label: string;
}

export interface AgentStreamParams {
  executionId: string;
  agentId: string;
  /** Name used in the human-readable message (agent id or instruction id). */
  name: string;
  /** Role/spec label carried in the details. */
  label: string;
  event: AgentEvent;
}

export interface AgentDoneParams {
  executionId: string;
  agentId: string;
  /** Name used in the human-readable message (agent id or instruction id). */
  name: string;
  passed?: boolean;
  summary?: string;
}

/** Emit `feature-forge:agent-started` (single D4 payload contract). */
export function emitAgentStarted(
  emitter: AgentChannelEmitterLike,
  params: AgentStartedParams,
): void {
  emitter.emit("feature-forge:agent-started", {
    phase: "agent-started",
    message: `Agent "${params.name}" (${params.label}) started`,
    details: { executionId: params.executionId, agentId: params.agentId },
  });
}

/** Emit `feature-forge:agent-stream` (single D4 payload contract). */
export function emitAgentStream(emitter: AgentChannelEmitterLike, params: AgentStreamParams): void {
  emitter.emit("feature-forge:agent-stream", {
    phase: "agent-stream",
    message: `Agent "${params.name}" stream event`,
    details: {
      executionId: params.executionId,
      agentId: params.agentId,
      label: params.label,
      event: params.event,
    },
  });
}

/**
 * Emit `feature-forge:agent-done` (single D4 payload contract). The message
 * reports "failed" iff `passed === false`, "completed" otherwise.
 */
export function emitAgentDone(emitter: AgentChannelEmitterLike, params: AgentDoneParams): void {
  emitter.emit("feature-forge:agent-done", {
    phase: "agent-done",
    message: `Agent "${params.name}" ${params.passed === false ? "failed" : "completed"}`,
    details: {
      executionId: params.executionId,
      agentId: params.agentId,
      passed: params.passed,
      summary: params.summary,
    },
  });
}
