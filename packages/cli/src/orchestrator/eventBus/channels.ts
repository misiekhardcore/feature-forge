import type { AgentEvent } from "@earendil-works/pi-agent-core";

/**
 * Typed channel-to-payload mapping for all feature-forge event bus channels.
 *
 * Every channel emitted via {@link TypedEventBus} must have an entry here.
 * The compile-time contract ensures emit and on sites agree on payload shape.
 */
export interface ForgeChannels {
  "feature-forge:agent-started": {
    phase: "agent-started";
    message: string;
    details: { executionId: string; agentId: string };
  };

  "feature-forge:agent-stream": {
    phase: "agent-stream";
    message: string;
    details: {
      executionId: string;
      agentId: string;
      label: string;
      event: AgentEvent;
    };
  };

  "feature-forge:agent-done": {
    phase: "agent-done";
    message: string;
    details: {
      executionId: string;
      agentId: string;
      passed?: boolean;
      summary?: string;
    };
  };

  "feature-forge:cleanup-start": {
    phase: "cleanup-start";
    message: string;
    details: { executionId?: string };
  };

  "feature-forge:cleanup-done": {
    phase: "cleanup-done";
    message: string;
    details: { executionId?: string; workspace?: string };
  };

  "feature-forge:git-start": {
    phase: "git-start";
    message: string;
    details: { executionId?: string };
  };

  "feature-forge:git-done": {
    phase: "git-done";
    message: string;
    details: { executionId?: string; passed: boolean; summary: string };
  };

  "feature-forge:shell-start": {
    phase: "shell-start";
    message: string;
    details: { executionId?: string };
  };

  "feature-forge:shell-done": {
    phase: "shell-done";
    message: string;
    details: { executionId?: string; passed: boolean; summary: string; prUrl?: string };
  };

  "feature-forge:workspace-ready": {
    phase: "workspace-ready";
    message: string;
    details: { executionId?: string; path: string; branch: string };
  };

  "feature-forge:loop-round-start": {
    phase: "loop-round-start";
    message: string;
    details: { executionId?: string; round: number; maxIterations: number; continueWhile?: string };
  };

  "feature-forge:loop-round-complete": {
    phase: "loop-round-complete";
    message: string;
    details: { executionId?: string; round: number; maxIterations: number; continueWhile?: string };
  };

  "feature-forge:parallel-start": {
    phase: "parallel-start";
    message: string;
    details: { executionId?: string };
  };

  "feature-forge:parallel-done": {
    phase: "parallel-done";
    message: string;
    details: { executionId?: string };
  };

  "feature-forge:session-set": {
    phase: "session-set";
    message: string;
    details: { key: string; value: string; executionId?: string };
  };
}
