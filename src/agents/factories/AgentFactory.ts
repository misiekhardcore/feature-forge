import { Agent } from "../agents";
import { AgentSpecification } from "../specifications";

/**
 * Creates Agent instances from AgentSpecifications.
 * Each implementation handles the concrete "how" of spawning
 * (local process, tmux, Docker, remote SSH, etc.).
 */
export abstract class AgentFactory {
  /**
   * Create a new Agent from its specification.
   * This includes allocating workspace, starting the process,
   * and establishing communication channels.
   *
   * @throws AgentCreationError if the agent cannot be created
   */
  public abstract create(specification: AgentSpecification): Promise<Agent>;
}

/**
 * Thrown when an AgentFactory cannot create an Agent.
 */
export class AgentCreationError extends Error {
  public readonly specificationId: string;

  constructor(specificationId: string, reason: string, cause?: Error) {
    super(`Failed to create agent "${specificationId}": ${reason}`);
    this.name = "AgentCreationError";
    this.specificationId = specificationId;
    this.cause = cause;
  }
}
