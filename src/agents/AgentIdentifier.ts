/**
 * Uniquely identifies an agent within the system.
 * Value object — equality is based on the id string.
 */
export class AgentIdentifier {
  public readonly value: string;

  constructor(value: string) {
    if (!value || value.trim().length === 0) {
      throw new Error("AgentIdentifier must not be empty");
    }
    this.value = value;
  }

  public equals(other: AgentIdentifier): boolean {
    return this.value === other.value;
  }

  public toString(): string {
    return this.value;
  }
}
