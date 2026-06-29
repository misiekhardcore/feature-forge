/**
 * Value object representing an agent's unique identifier.
 *
 * Wraps a non-empty string and provides value-equality semantics
 * so identifiers can be compared and used as map keys reliably.
 */
export class AgentIdentifier {
  /** The underlying identifier string (trimmed, non-empty). */
  public readonly id: string;

  /**
   * @param params.id - The agent identifier string. Must be non-empty after trimming.
   * @throws {Error} If id is empty or whitespace-only.
   */
  constructor(params: { id: string }) {
    const trimmed = params.id.trim();
    if (trimmed.length === 0) {
      throw new Error("AgentIdentifier id must not be empty");
    }
    this.id = trimmed;
  }

  /** Returns the identifier string. */
  public toString(): string {
    return this.id;
  }

  /**
   * Value-equality comparison based on the underlying id string.
   * @returns true if both identifiers have the same id.
   */
  public equals(other: AgentIdentifier): boolean {
    return this.id === other.id;
  }
}
