import { AgentStatus } from "../base";

/**
 * The slim, truly common contract shared by every agent, regardless of
 * interaction model.
 *
 * Both families — {@link SubprocessAgent} (discrete RPC result) and
 * {@link InSessionAgent} (drives the live session) — share only identity,
 * creation time, lifecycle status, and environment-scoped teardown. The
 * family-specific contracts (e.g. `executeTask` / `mount`) live on the
 * respective abstract intermediates so the base never forces a no-op onto
 * either family.
 *
 * @see docs/adr/0007-agent-hierarchy-subprocess-vs-in-session.md
 */
export abstract class Agent {
  /** Stable fleet identifier (unique within a supervisor's map). */
  public abstract readonly id: string;

  /** When the agent instance was constructed. */
  public readonly createdAt: Date = new Date();

  /** Lifecycle status, kept on the base for uniform visualisation. */
  public abstract readonly status: AgentStatus;

  /**
   * Environment-scoped teardown.
   *
   * Subprocess: stop the RPC process. In-session: deregister the
   * `before_agent_start` hook, clear active tools, and end participation in
   * the live conversation. Always transitions {@link status} to
   * {@link AgentStatus.Cancelled}.
   */
  public abstract destroy(): Promise<void>;
}
