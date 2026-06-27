import type { ImageContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { AgentStatus } from "../base";
import { AgentSpecification } from "../specifications";

/**
 * Options for {@link Agent.executeTask}.
 */
export interface ExecuteTaskOptions {
  /** Optional image content to include in the prompt. */
  images?: ImageContent[];
  /** Timeout in milliseconds for this task execution. */
  timeout?: number;
}

/**
 * A running agent instance.
 * This is the "handle" the orchestrator uses to interact with a live agent.
 *
 * The agent owns its own result delivery — it formats success and error
 * messages in an agent-specific way and sends them to the parent session
 * via `pi.sendMessage()`.
 */
export abstract class Agent {
  public abstract readonly id: string;
  public abstract readonly specification: AgentSpecification;
  public abstract readonly status: AgentStatus;
  public readonly createdAt: Date = new Date();

  /**
   * Send a task to the agent for execution.
   * The agent processes the task and returns once complete.
   */
  public abstract executeTask(task: string, options?: ExecuteTaskOptions): Promise<string>;

  /**
   * Signal the agent to stop what it's doing and shut down.
   * Returns once the agent has been terminated (gracefully or forcefully).
   */
  public abstract destroy(): Promise<void>;

  /**
   * The agent's final result, if it Completed successfully.
   * Throws if the agent is not in Completed state.
   */
  public abstract getResult(): string;

  /**
   * The error that caused the agent to fail, if applicable.
   * Throws if the agent is not in Failed or Cancelled state.
   */
  public abstract getError(): Error | undefined;

  /**
   * Deliver a successful result to the parent session via pi.sendMessage().
   * Each agent type formats its own output (markdown, json, etc.).
   */
  public abstract deliverResult(task: string, result: string, pi: ExtensionAPI): void;

  /**
   * Deliver a failure notification to the parent session via pi.sendMessage().
   * Each agent type formats its own error presentation.
   */
  public abstract deliverError(task: string, error: Error, pi: ExtensionAPI): void;
}
