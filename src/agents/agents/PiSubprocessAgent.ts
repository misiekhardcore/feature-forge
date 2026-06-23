import { AgentEvent } from "@earendil-works/pi-agent-core";
import { ImageContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { RpcClient } from "@earendil-works/pi-coding-agent";

import { AgentStatus } from "../base";
import { AgentSpecification } from "../specifications";
import { Agent } from "./Agent";

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
 * Concrete Agent that wraps a pi subprocess spawned in RPC mode.
 *
 * Delegates all lifecycle (start, stop, communicate) to the underlying RpcClient.
 */
export class PiSubprocessAgent extends Agent {
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
  public async start(): Promise<void> {
    try {
      await this.rpcClient.start();
      this._status = AgentStatus.Running;
    } catch (cause) {
      this._status = AgentStatus.Failed;
      this.error = cause instanceof Error ? cause : new Error(String(cause));
      throw this.error;
    }
  }

  /**
   * Send a prompt (task) to the subagent and wait for completion.
   * Returns the extracted assistant text response.
   */
  public async executeTask(
    task: string,
    images?: ImageContent[],
    timeout = 300_000,
  ): Promise<string> {
    if (this._status !== AgentStatus.Running) {
      throw new Error(`Cannot execute task on agent "${this.id}" in state "${this._status}"`);
    }

    try {
      const events = await this.rpcClient.promptAndWait(task, images, timeout);
      this.result = extractAssistantText(events);
      this._status = AgentStatus.Completed;
      return this.result;
    } catch (cause) {
      this._status = AgentStatus.Failed;
      this.error = cause instanceof Error ? cause : new Error(String(cause));
      throw this.error;
    }
  }

  /**
   * Signal the subagent to stop and clean up the RPC process.
   */
  public override async destroy(): Promise<void> {
    try {
      await this.rpcClient.stop();
    } catch {
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
  public override deliverResult(task: string, result: string, pi: ExtensionAPI): void {
    const header = this.capitalize(this.specification.role);
    pi.sendMessage(
      {
        customType: `${this.specification.role}_result`,
        content: `## ${header}: ${task}\n\n${result || "_(no findings produced)_"}`,
        display: true,
      },
      { triggerTurn: false },
    );
  }

  /**
   * Format and deliver an error notification to the parent session.
   */
  public override deliverError(task: string, error: Error, pi: ExtensionAPI): void {
    pi.sendMessage(
      {
        customType: `${this.specification.role}_error`,
        content: `## ❌ ${this.capitalize(this.specification.role)} failed: ${task}\n\n${error.message}`,
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
