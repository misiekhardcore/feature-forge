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

  static generateId(params: DynamicAgentSpecificationParams): string {
    return params.role + "-" + Math.random().toString(36).substring(2, 8);
  }
}
