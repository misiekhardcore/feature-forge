import { AgentSpecification, AgentSpecificationParams } from "./AgentSpecification";

type DynamicAgentSpecificationParams = Omit<AgentSpecificationParams, "id"> &
  Partial<Pick<AgentSpecificationParams, "id">>;
/**
 * A concrete `AgentSpecification` whose properties are set at runtime.
 *
 * Useful when agent specs are constructed from deserialized parameters
 * (e.g., over the IPC socket) rather than from a pre-defined subclass.
 */
export class DynamicAgentSpecification extends AgentSpecification {
  constructor(params: DynamicAgentSpecificationParams) {
    super({
      ...params,
      id: params.id ?? DynamicAgentSpecification.generateId(params),
    });
  }

  /**
   * Deserialize a JSON string into a `DynamicAgentSpecification`.
   *
   * Used by the child-side spec resolution extension to reconstruct
   * the agent spec from the `FORGE_SPEC` environment variable.
   */
  static fromJSON(json: string): DynamicAgentSpecification {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("FORGE_SPEC must be a JSON object");
    }
    return new DynamicAgentSpecification(parsed as DynamicAgentSpecificationParams);
  }

  /**
   * Serialize this specification to a plain object suitable for
   * `JSON.stringify`. Used by the parent process to pass the full
   * spec to child subprocesses via `FORGE_SPEC`.
   */
  toJSON(): AgentSpecificationParams {
    return {
      id: this.id,
      role: this.role,
      systemPrompt: this.systemPrompt,
      tools: this.tools,
      excludedTools: this.excludedTools,
      toolRestrictions: this.toolRestrictions,
      model: this.model,
      thinkingLevel: this.thinkingLevel,
      disableBuiltinTools: this.disableBuiltinTools,
      disableExtensions: this.disableExtensions,
      disableSkills: this.disableSkills,
      disablePromptTemplates: this.disablePromptTemplates,
      disableContextFiles: this.disableContextFiles,
      ephemeral: this.ephemeral,
      cwd: this.cwd,
    };
  }

  static generateId(params: Pick<AgentSpecificationParams, "role">): string {
    return params.role + "-" + Math.random().toString(36).substring(2, 8);
  }
}
