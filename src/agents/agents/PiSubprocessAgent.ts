import { RpcClient } from "@earendil-works/pi-coding-agent";
import { Agent } from "./Agent";
import { AgentIdentifier, AgentSpecification, AgentStatus } from "../base";

/**
 * Concrete Agent that wraps a pi subprocess spawned in RPC mode.
 *
 * Delegates all lifecycle (start, stop, communicate) to the underlying RpcClient.
 */
export class PiSubprocessAgent extends Agent {
  public readonly identifier: AgentIdentifier;
  public readonly specification: AgentSpecification;

  private _status: AgentStatus = AgentStatus.Spawned;
  private readonly rpcClient: RpcClient;
  private result: unknown = undefined;
  private error: Error | undefined = undefined;

  constructor(
    identifier: AgentIdentifier,
    specification: AgentSpecification,
    rpcClient: RpcClient,
  ) {
    super();
    this.identifier = identifier;
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
   * Collects the returned events as the result.
   */
  public async executeTask(task: string): Promise<unknown> {
    if (this._status !== AgentStatus.Running) {
      throw new Error(
        `Cannot execute task on agent "${this.identifier}" in state "${this._status}"`,
      );
    }

    try {
      const events = await this.rpcClient.promptAndWait(task);
      this.result = events;
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
   * Return the events collected from the last executed task.
   */
  public override getResult(): unknown {
    if (this._status !== AgentStatus.Completed) {
      throw new Error(
        `Agent "${this.identifier}" is not in Completed state (current: "${this._status}")`,
      );
    }
    return this.result;
  }

  /**
   * Return the error that caused the agent to fail.
   */
  public override getError(): Error | undefined {
    if (this._status !== AgentStatus.Failed && this._status !== AgentStatus.Cancelled) {
      throw new Error(
        `Agent "${this.identifier}" is not in Failed or Cancelled state (current: "${this._status}")`,
      );
    }
    return this.error;
  }
}
