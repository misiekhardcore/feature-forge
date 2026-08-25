import { AgentSpecification } from "../specifications";

/**
 * Describes what an agent is allowed to do.
 * Governance is consulted at spawn time and may be checked during execution.
 */
export class AgentPermissions {
  /**
   * Names of tools the agent is explicitly allowed to use.
   * An empty array means all tools are forbidden.
   * null / undefined means no restriction (inherit parent's policy).
   */
  public readonly allowedTools: readonly string[] | null;

  /**
   * Maximum wall-clock time the agent may run before being forcefully terminated.
   * undefined means no timeout (inherit parent's policy).
   */
  public readonly timeToLiveMs: number | undefined;

  /**
   * Maximum number of tool calls the agent may make.
   * undefined means no limit.
   */
  public readonly maxToolCalls: number | undefined;

  constructor(params: {
    allowedTools?: readonly string[] | null;
    timeToLiveMs?: number;
    maxToolCalls?: number;
  }) {
    this.allowedTools = params.allowedTools ?? null;
    this.timeToLiveMs = params.timeToLiveMs;
    this.maxToolCalls = params.maxToolCalls;
  }
}

/**
 * Determines the governance policy for an agent specification.
 * Different implementations can apply different rules
 * (role-based, specification-based, global defaults, etc.).
 */
export abstract class AgentGovernancePolicy {
  /**
   * Resolve the permissions for a given agent specification.
   * This is called at spawn time to determine what the agent may do.
   */
  public abstract resolvePermissions(specification: AgentSpecification): Promise<AgentPermissions>;

  /**
   * Check whether a specific action is allowed for a running agent.
   * Called during execution to enforce governance in real time.
   * Default implementation delegates to resolvePermissions.
   */
  public abstract isActionAllowed(
    specification: AgentSpecification,
    actionName: string,
  ): Promise<boolean>;
}
