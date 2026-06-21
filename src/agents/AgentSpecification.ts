import { AgentIdentifier } from "./AgentIdentifier";

/**
 * Immutable specification that defines what an agent is and how it should behave.
 * This is the "blueprint" — it does not hold runtime state.
 */
export abstract class AgentSpecification {
  public readonly identifier: AgentIdentifier;
  public readonly role: string;
  public readonly systemPrompt: string;
  public readonly toolNames: readonly string[];
  public readonly modelPreference: string | undefined;

  constructor(params: {
    identifier: AgentIdentifier;
    role: string;
    systemPrompt: string;
    toolNames?: readonly string[];
    modelPreference?: string;
  }) {
    this.identifier = params.identifier;
    this.role = params.role;
    this.systemPrompt = params.systemPrompt;
    this.toolNames = params.toolNames ?? [];
    this.modelPreference = params.modelPreference;
  }
}
