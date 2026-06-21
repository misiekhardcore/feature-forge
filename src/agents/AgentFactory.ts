import { Agent } from "./Agent";
import { AgentSpecification } from "./AgentSpecification";

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
  public readonly specificationIdentifier: string;

  constructor(specificationIdentifier: string, reason: string, cause?: Error) {
    super(`Failed to create agent "${specificationIdentifier}": ${reason}`);
    this.name = "AgentCreationError";
    this.specificationIdentifier = specificationIdentifier;
    this.cause = cause;
  }
}
