import { AgentEvent } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import { AgentStatus } from "@feature-forge/shared";

import { logger } from "../../logging";
import { AgentSpecification } from "../specifications";
import { type ExecuteTaskOptions, SubprocessAgent } from "./SubprocessAgent";

/**
 * Default timeout for agent task execution (ms).
 * Override via the `FORGE_TASK_TIMEOUT_MS` environment variable.
 */
export const DEFAULT_TASK_TIMEOUT_MS = Number(process.env.FORGE_TASK_TIMEOUT_MS) || 60 * 60 * 1000; // 1 hour

function extractAssistantText(events: AgentEvent[]): string {
  const parts: string[] = [];
  for (const event of events) {
    if (
      event.type === "message_end" &&
      event.message?.role === "assistant" &&
      event.message.content
    ) {
      for (const block of event.message.content) {
        if (block.type === "text" && block.text) {
          parts.push(block.text);
        }
      }
    }
  }
  return parts.join("\n\n");
}

/**
 * Concrete {@link SubprocessAgent} that wraps a pi subprocess spawned in RPC mode.
 *
 * Delegates all lifecycle (start, stop, communicate) to the underlying RpcClient.
 */
export class PiSubprocessAgent extends SubprocessAgent {
  public readonly id: string;
  public readonly specification: AgentSpecification;

  private _status: AgentStatus = AgentStatus.Spawned;
  private readonly rpcClient: RpcClient;
  private result: string = "";
  private error: Error | undefined = undefined;

  constructor(id: string, specification: AgentSpecification, rpcClient: RpcClient) {
    super();
    this.id = id;
    this.specification = specification;
    this.rpcClient = rpcClient;
  }

  public get status(): AgentStatus {
    return this._status;
  }

  /**
   * Start the underlying RPC process and transition to Running.
   * Must be called before sending tasks.
   */
  public override async start(): Promise<void> {
    try {
      await this.rpcClient.start();
      this._status = AgentStatus.Running;
    } catch (error) {
      logger.error("Agent start failed", { agentId: this.id, error });
      this._status = AgentStatus.Failed;
      this.error = error instanceof Error ? error : new Error(String(error));
      throw this.error;
    }
  }

  /**
   * Send a prompt (task) to the subagent and wait for completion.
   * Returns the extracted assistant text response.
   */
  public override async executeTask(prompt: string, options?: ExecuteTaskOptions): Promise<string> {
    if (this._status !== AgentStatus.Running) {
      throw new Error(`Cannot execute task on agent "${this.id}" in state "${this._status}"`);
    }

    options?.signal?.throwIfAborted();

    options?.signal?.throwIfAborted();

    // Wire the abort signal so pressing Esc immediately stops the underlying
    // RPC process rather than waiting for the agent to finish naturally.
    const onAbort = (): void => {
      void this.rpcClient.abort();
    };
    options?.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const timeout = options?.timeout ?? DEFAULT_TASK_TIMEOUT_MS;
      const events = await this.rpcClient.promptAndWait(prompt, options?.images, timeout);
      this.result = extractAssistantText(events);
      this._status = AgentStatus.Completed;
      return this.result;
    } catch (error) {
      logger.error("Task execution failed", { agentId: this.id, prompt, error });
      this._status = AgentStatus.Failed;
      this.error = error instanceof Error ? error : new Error(String(error));
      throw this.error;
    } finally {
      options?.signal?.removeEventListener("abort", onAbort);
    }
  }

  /**
   * Signal the subagent to stop and clean up the RPC process.
   */
  public override async destroy(): Promise<void> {
    try {
      await this.rpcClient.stop();
    } catch {
      logger.warn("RPC stop failed during destroy", { agentId: this.id });
      // Swallow stop errors — agent is being destroyed either way
    }
    this._status = AgentStatus.Cancelled;
  }

  /**
   * Return the extracted assistant text from the last executed task.
   */
  public override getResult(): string {
    if (this._status !== AgentStatus.Completed) {
      throw new Error(`Agent "${this.id}" is not in Completed state (current: "${this._status}")`);
    }
    return this.result;
  }

  /**
   * Return the error that caused the agent to fail.
   */
  public override getError(): Error | undefined {
    if (this._status !== AgentStatus.Failed && this._status !== AgentStatus.Cancelled) {
      throw new Error(
        `Agent "${this.id}" is not in Failed or Cancelled state (current: "${this._status}")`,
      );
    }
    return this.error;
  }

  /**
   * Format and deliver a successful result to the parent session.
   *
   * Uses the agent's role as the section header so each agent type gets
   * its own visual identity in the chat output.
   */
  public override deliverResult(prompt: string, result: string, pi: ExtensionAPI): void {
    const header = this.capitalize(this.specification.role);
    pi.sendMessage(
      {
        customType: `${this.specification.role}_result`,
        content: `## ${header}: ${prompt}\n\n${result || "_(no findings produced)_"}`,
        display: true,
      },
      { triggerTurn: false },
    );
  }

  /**
   * Format and deliver an error notification to the parent session.
   */
  public override deliverError(prompt: string, error: Error, pi: ExtensionAPI): void {
    pi.sendMessage(
      {
        customType: `${this.specification.role}_error`,
        content: `## ❌ ${this.capitalize(this.specification.role)} failed: ${prompt}\n\n${error.message}`,
        display: true,
      },
      { triggerTurn: false },
    );
  }

  /** Capitalize the first letter of the role for display headers. */
  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
