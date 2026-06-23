import { AgentSpecification, AgentSpecificationParams } from "./AgentSpecification";

/**
 * A concrete `AgentSpecification` whose properties are set at runtime.
 *
 * Useful when agent specs are constructed from deserialized parameters
 * (e.g., over the IPC socket) rather than from a pre-defined subclass.
 */
export class DynamicAgentSpecification extends AgentSpecification {
  constructor(
    params: Omit<AgentSpecificationParams, "id"> & Partial<Pick<AgentSpecificationParams, "id">>,
  ) {
    super({
      ...params,
      id: params.id ?? params.role,
    });
  }
}
