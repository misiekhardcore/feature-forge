import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { Agent, InSessionAgent, SubprocessAgent } from "../agents";
import { AgentSpecification } from "../specifications";

/**
 * Manages the unified fleet lifecycle of agents: spawning, tracking,
 * listing, and destroying. Acts as the orchestrator's interface to a fleet of
 * agents that span both the subprocess and in-session families.
 *
 * The fleet lifecycle is unified (both families share one tracking map, both
 * keyed on {@link AgentSpecification}); the *interaction* model stays
 * family-specific — see ADR 0007.
 */
export abstract class AgentSupervisor {
  /**
   * Spawn a new subprocess agent from its specification and start tracking it.
   * Returns once the agent is in Running state (or fails to start).
   *
   * Both spawn entrypoints take an {@link AgentSpecification}; the only
   * difference is *how* the spec becomes a running agent.
   */
  public abstract spawnGuest(specification: AgentSpecification): Promise<SubprocessAgent>;

  /**
   * Construct and register an in-session agent from its specification.
   *
   * Does not call `mount` — the caller receives the {@link InSessionAgent}
   * and drives it (`agent.mount(pi, task)`) so it controls the resolved task
   * string and the live session.
   */
  public abstract mountInSession(specification: AgentSpecification): Promise<InSessionAgent>;

  /**
   * Spawn, execute a task, deliver results via agent-owned formatting, then destroy.
   *
   * Subprocess-only convenience: one-shot spawn → `executeTask` → `getResult`
   * → `deliverResult` → destroy. Never called for an in-session agent (those
   * go via `mountInSession` + `mount` + `destroy`).
   */
  public abstract runAgent(
    specification: AgentSpecification,
    prompt: string,
    pi?: ExtensionAPI,
  ): Promise<void>;

  /**
   * Retrieve a tracked agent by its id (either family).
   * Returns undefined if no agent with this id is known.
   */
  public abstract getAgent(agentId: string): Agent | undefined;

  /**
   * Return all currently tracked agents (either family).
   */
  public abstract getAllAgents(): readonly Agent[];

  /**
   * Destroy a specific agent and clean up its resources.
   * Removes it from tracking. Safe to call multiple times.
   */
  public abstract destroyAgent(agentId: string): Promise<void>;

  /**
   * Destroy all tracked agents.
   */
  public abstract destroyAll(): Promise<void>;
}
