import { AgentIdentifier, AgentSpecification, AgentStatus } from "../base";

/**
 * A running agent instance.
 * This is the "handle" the orchestrator uses to interact with a live agent.
 */
export abstract class Agent {
  public abstract readonly identifier: AgentIdentifier;
  public abstract readonly specification: AgentSpecification;
  public abstract readonly status: AgentStatus;

  /**
   * Send a task to the agent for execution.
   * The agent processes the task and returns once complete.
   */
  public abstract executeTask(task: string): Promise<unknown>;

  /**
   * Signal the agent to stop what it's doing and shut down.
   * Returns once the agent has been terminated (gracefully or forcefully).
   */
  public abstract destroy(): Promise<void>;

  /**
   * The agent's final result, if it Completed successfully.
   * Throws if the agent is not in Completed state.
   */
  public abstract getResult(): unknown;

  /**
   * The error that caused the agent to fail, if applicable.
   * Throws if the agent is not in Failed or Cancelled state.
   */
  public abstract getError(): Error | undefined;
}
