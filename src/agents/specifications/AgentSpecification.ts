import { ThinkingLevel } from "@earendil-works/pi-agent-core";

export type AgentSpecificationParams = {
  id: string;
  role: string;
  systemPrompt: string;
  tools?: readonly string[];
  excludedTools?: readonly string[];
  model?: string;
  thinkingLevel?: ThinkingLevel;
  disableBuiltinTools?: boolean;
  disableExtensions?: boolean;
  disableSkills?: boolean;
  disablePromptTemplates?: boolean;
  disableContextFiles?: boolean;
  ephemeral?: boolean;
  /** Working directory for the agent process (defaults to process.cwd()). */
  cwd?: string;
};

/**
 * Immutable specification that defines what an agent is and how it should behave.
 *
 * Maps to pi CLI flags and `createAgentSession` options. Every field has a
 * sensible default — subclasses only set what they need to override.
 */
export abstract class AgentSpecification {
  public readonly id: string;
  public readonly role: string;
  public readonly systemPrompt: string;

  /** Allowlist of tool names. Empty = use default tools. */
  public readonly tools: readonly string[];
  /** Denylist of tool names to disable even if they'd otherwise be active. */
  public readonly excludedTools: readonly string[];
  /** Model pattern (e.g. "claude-sonnet-4-5"). Undefined = use default. */
  public readonly model?: string | undefined;
  /** Thinking/reasoning level. Undefined = use default. */
  public readonly thinkingLevel?: ThinkingLevel | undefined;
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
  /** Working directory for the agent process. */
  public readonly cwd?: string | undefined;

  constructor(params: AgentSpecificationParams) {
    if (!params.id || params.id.trim().length === 0) {
      throw new Error("AgentSpecification id must not be empty");
    }
    this.id = params.id;
    this.role = params.role;
    this.systemPrompt = params.systemPrompt;
    this.tools = params.tools ?? [];
    this.excludedTools = params.excludedTools ?? [];
    this.model = params.model;
    this.thinkingLevel = params.thinkingLevel;
    this.disableBuiltinTools = params.disableBuiltinTools ?? false;
    this.disableExtensions = params.disableExtensions ?? false;
    this.disableSkills = params.disableSkills ?? false;
    this.disablePromptTemplates = params.disablePromptTemplates ?? false;
    this.disableContextFiles = params.disableContextFiles ?? false;
    this.ephemeral = params.ephemeral ?? false;
    this.cwd = params.cwd;
  }
}
