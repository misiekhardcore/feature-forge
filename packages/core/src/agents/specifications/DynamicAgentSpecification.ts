import { jsonParse } from "@feature-forge/core/src/helpers";

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
    const parsed = jsonParse<DynamicAgentSpecificationParams | null>(json);
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("FORGE_SPEC must be a JSON object");
    }
    return new DynamicAgentSpecification(parsed);
  }

  static generateId(params: Pick<AgentSpecificationParams, "role">): string {
    return params.role + "-" + Math.random().toString(36).substring(2, 8);
  }
}
