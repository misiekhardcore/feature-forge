import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { Agent } from "./Agent";

/**
 * Options for {@link SubprocessAgent.executeTask}.
 */
export interface ExecuteTaskOptions {
  /** Optional image content to include in the prompt. */
  images?: ImageContent[];
  /** Timeout in milliseconds for this prompt execution. */
  timeout?: number;
  /** Optional AbortSignal to cancel the task execution. */
  signal?: AbortSignal;
  /** Receive real-time AgentEvents during execution. */
  onEvent?: (event: AgentEvent) => void;
}

/**
 * Intermediate base for agents that run in a *separate* process and report a
 * discrete awaited result back to the parent session.
 *
 * Members that only make sense for the subprocess/RPC model live here rather
 * than on the slim {@link Agent} base, so an in-session agent is never forced
 * to implement a no-op `executeTask`/`deliverResult`.
 *
 * @see docs/adr/0007-agent-hierarchy-subprocess-vs-in-session.md
 */
export abstract class SubprocessAgent extends Agent {
  /** Start the underlying transport and transition to {@link AgentStatus.Running}. */
  public abstract start(): Promise<void>;

  /** Send a prompt (task) to the agent and wait for completion. */
  public abstract executeTask(prompt: string, options?: ExecuteTaskOptions): Promise<string>;

  /** The final result of the last successful {@link executeTask}. */
  public abstract getResult(): string;

  /** The error that caused the agent to fail, if applicable. */
  public abstract getError(): Error | undefined;

  /** Deliver a successful result to the parent session via `pi.sendMessage()`. */
  public abstract deliverResult(prompt: string, result: string, pi: ExtensionAPI): void;

  /** Deliver a failure notification to the parent session via `pi.sendMessage()`. */
  public abstract deliverError(prompt: string, error: Error, pi: ExtensionAPI): void;
}
