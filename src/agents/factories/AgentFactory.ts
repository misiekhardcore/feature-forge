import { SubprocessAgent } from "../agents";
import { AgentSpecification } from "../specifications";

/**
 * Creates Agent instances from AgentSpecifications.
 * Each implementation handles the concrete "how" of spawning
 * (local process, tmux, Docker, remote SSH, etc.).
 *
 * Returns a {@link SubprocessAgent} — the abstraction that owns `start()` —
 * so callers depend on the subprocess contract rather than the slim
 * {@link Agent} base (see ADR 0007).
 */
export abstract class AgentFactory {
  /**
   * Create a new {@link SubprocessAgent} from its specification.
   * This includes allocating workspace, starting the process,
   * and establishing communication channels.
   *
   * @throws AgentCreationError if the agent cannot be created
   */
  public abstract create(specification: AgentSpecification): Promise<SubprocessAgent>;
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
