import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { Agent } from "../agents";
import { AgentSpecification } from "../specifications";

/**
 * Manages the full lifecycle of agents: spawning, monitoring, and destroying.
 * Acts as the orchestrator's interface to a fleet of agents.
 */
export abstract class AgentSupervisor {
  /**
   * Spawn a new agent from its specification and start tracking it.
   * Returns once the agent is in Running state (or fails to start).
   */
  public abstract spawn(specification: AgentSpecification): Promise<Agent>;

  /**
   * Spawn, execute a task, deliver results via agent-owned formatting, then destroy.
   *
   * This is the primary fire-and-forget entry point. The caller just passes
   * the spec, task, and the extension's `pi` handle — the supervisor (and the
   * agent itself) handle everything else internally.
   */
  public abstract runAgent(
    specification: AgentSpecification,
    task: string,
    pi?: ExtensionAPI,
  ): Promise<void>;

  /**
   * Retrieve a tracked agent by its id.
   * Returns undefined if no agent with this id is known.
   */
  public abstract getAgent(agentId: string): Agent | undefined;

  /**
   * Return all currently tracked agents.
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
