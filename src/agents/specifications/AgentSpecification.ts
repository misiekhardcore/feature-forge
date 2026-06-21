import { AgentIdentifier } from "../base";

/**
 * Thinking/reasoning level for the agent.
 * Mirrors pi's --thinking flag.
 */
export type ThinkingLevel = "off" | "low" | "medium" | "high";

/**
 * Immutable specification that defines what an agent is and how it should behave.
 *
 * Maps to pi CLI flags and `createAgentSession` options. Every field has a
 * sensible default — subclasses only set what they need to override.
 */
export abstract class AgentSpecification {
  public readonly identifier: AgentIdentifier;
  public readonly role: string;
  public readonly systemPrompt: string;

  /** Allowlist of tool names. Empty = use default tools. */
  public readonly toolNames: readonly string[];
  /** Denylist of tool names to disable even if they'd otherwise be active. */
  public readonly excludeToolNames: readonly string[];
  /** Model pattern (e.g. "claude-sonnet-4-5"). Undefined = use default. */
  public readonly modelPreference: string | undefined;
  /** Thinking/reasoning level. Undefined = use default. */
  public readonly thinkingLevel: ThinkingLevel | undefined;
  /** Disable all built-in tools (read, bash, edit, write, etc.). */
  public readonly disableBuiltinTools: boolean;
  /** Disable extension discovery and loading. */
  public readonly disableExtensions: boolean;
  /** Disable skill discovery and loading. */
  public readonly disableSkills: boolean;
  /** Disable prompt template discovery and loading. */
  public readonly disablePromptTemplates: boolean;
  /** Disable AGENTS.md and CLAUDE.md auto-loading. */
  public readonly disableContextFiles: boolean;
  /** Don't persist the session to disk (ephemeral agent). */
  public readonly ephemeral: boolean;

  constructor(params: {
    identifier: AgentIdentifier;
    role: string;
    systemPrompt: string;
    toolNames?: readonly string[];
    excludeToolNames?: readonly string[];
    modelPreference?: string;
    thinkingLevel?: ThinkingLevel;
    disableBuiltinTools?: boolean;
    disableExtensions?: boolean;
    disableSkills?: boolean;
    disablePromptTemplates?: boolean;
    disableContextFiles?: boolean;
    ephemeral?: boolean;
  }) {
    this.identifier = params.identifier;
    this.role = params.role;
    this.systemPrompt = params.systemPrompt;
    this.toolNames = params.toolNames ?? [];
    this.excludeToolNames = params.excludeToolNames ?? [];
    this.modelPreference = params.modelPreference;
    this.thinkingLevel = params.thinkingLevel;
    this.disableBuiltinTools = params.disableBuiltinTools ?? false;
    this.disableExtensions = params.disableExtensions ?? false;
    this.disableSkills = params.disableSkills ?? false;
    this.disablePromptTemplates = params.disablePromptTemplates ?? false;
    this.disableContextFiles = params.disableContextFiles ?? false;
    this.ephemeral = params.ephemeral ?? false;
  }
}
