import { AgentSpecification } from "../specifications";
import { AgentGovernancePolicy, AgentPermissions } from "./AgentGovernancePolicy";

/**
 * Default governance policy that applies simple rules:
 *
 * - If the specification has no tool names, all tools are allowed (null = unrestricted).
 * - If the specification has tool names, only those tools are allowed.
 * - TimeToLive is inherited from specification if present, else no timeout.
 */
export class DefaultAgentGovernancePolicy extends AgentGovernancePolicy {
  /**
   * Resolve permissions based on the specification's tool list.
   * An empty tool list means unrestricted (null), a non-empty list means restricted.
   */
  public override async resolvePermissions(
    specification: AgentSpecification,
  ): Promise<AgentPermissions> {
    const allowedTools = specification.toolNames.length > 0 ? specification.toolNames : null;

    return new AgentPermissions({
      allowedTools,
      timeToLiveMs: undefined, // No default timeout
      maxToolCalls: undefined, // No default limit
    });
  }

  /**
   * Check if a specific action is allowed.
   * If permissions have no tool restriction (null), everything is allowed.
   * Otherwise, the action name must be in the allowed tools list.
   */
  public override async isActionAllowed(
    specification: AgentSpecification,
    actionName: string,
  ): Promise<boolean> {
    const permissions = await this.resolvePermissions(specification);

    if (permissions.allowedTools === null) {
      return true;
    }

    return permissions.allowedTools.includes(actionName);
  }
}
