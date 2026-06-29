import type { ThinkingLevel } from "../agents/specifications/AgentSpecification";

/** Parameters for constructing a ModelConfig value object. */
export type ModelConfigParams = {
  /** Model identifier (e.g. "claude-sonnet-4-5-20250929"). */
  modelId: string;
  /** Thinking/reasoning level for the agent process. */
  thinkingLevel?: ThinkingLevel | undefined;
};

/**
 * Immutable model configuration for a single effort tier (high / medium / low).
 *
 * Declares which model to use and at what thinking level when spawning an agent
 * at this tier.
 */
export class ModelConfig {
  public readonly modelId: string;
  public readonly thinkingLevel?: ThinkingLevel | undefined;

  constructor(params: ModelConfigParams) {
    if (!params.modelId || params.modelId.trim().length === 0) {
      throw new Error("ModelConfig modelId must not be empty");
    }
    this.modelId = params.modelId;
    this.thinkingLevel = params.thinkingLevel;
  }

  /** Structural equality based on all fields. */
  equals(other: unknown): boolean {
    if (!(other instanceof ModelConfig)) return false;
    return this.modelId === other.modelId && this.thinkingLevel === other.thinkingLevel;
  }

  /** Human-readable representation for debug/log output. */
  toString(): string {
    return `ModelConfig(modelId="${this.modelId}", thinkingLevel=${this.thinkingLevel ?? "default"})`;
  }
}
