import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { logger } from "../../logging";
import { Agent, InSessionAgent, SessionAgent, SubprocessAgent } from "../agents";
import { AgentFactory } from "../factories";
import { AgentSpecification } from "../specifications";
import { AgentSupervisor } from "./AgentSupervisor";

/**
 * Concrete AgentSupervisor that tracks agents in an in-memory map.
 *
 * Spawning is delegated to the injected AgentFactory, but the supervisor
 * owns the lifecycle tracking — it can destroy individual agents or all
 * agents at once, and provides lookup by id.
 */
export class InMemoryAgentSupervisor extends AgentSupervisor {
  private readonly agents = new Map<string, Agent>();

  constructor(private readonly agentFactory: AgentFactory) {
    super();
  }

  /**
   * Spawn a new subprocess agent via the injected factory and start tracking it.
   */
  public override async spawnGuest(specification: AgentSpecification): Promise<SubprocessAgent> {
    const agent = await this.agentFactory.create(specification);
    this.agents.set(agent.id, agent);
    return agent;
  }

  /**
   * Construct and register an in-session {@link SessionAgent}.
   */
  public override async mountInSession(specification: AgentSpecification): Promise<InSessionAgent> {
    const agent = new SessionAgent(specification);
    this.agents.set(agent.id, agent);
    return agent;
  }

  /**
   * Retrieve a tracked agent by its string id.
   */
  public override getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Return all currently tracked agents as a snapshot.
   */
  public override getAllAgents(): readonly Agent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Destroy a single agent and remove it from tracking.
   * Safe to call multiple times — second call is a no-op.
   */
  public override async destroyAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return;
    }
    await agent.destroy();
    this.agents.delete(agentId);
  }

  /**
   * Destroy all tracked agents and clear the map.
   */
  public override async destroyAll(): Promise<void> {
    const entries = Array.from(this.agents.entries());
    await Promise.allSettled(
      entries.map(async ([id]) => {
        await this.destroyAgent(id);
      }),
    );
  }

  /**
   * Full lifecycle: spawn → execute → agent delivers result/error → destroy.
   *
   * The agent owns its own result formatting and delivery (via pi.sendMessage).
   * The caller does not need to await this — the supervisor handles everything
   * internally (fire-and-forget safe).
   */
  public override async runAgent(
    specification: AgentSpecification,
    prompt: string,
    pi: ExtensionAPI,
  ): Promise<void> {
    const id = specification.id;

    let agent: SubprocessAgent;
    try {
      agent = await this.spawnGuest(specification);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      logger.error("Agent spawn failed", { agentId: id, prompt, error: err });
      return this.printAgentError(id, prompt, err, pi);
    }

    try {
      const result = await agent.executeTask(prompt);
      agent.deliverResult(prompt, result, pi);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error("Agent execution failed", { agentId: id, prompt, error });
      agent.deliverError(prompt, err, pi);
    } finally {
      await this.destroyAgent(id);
    }
  }

  printAgentError(agentId: string, prompt: string, error: Error, pi: ExtensionAPI): void {
    // No agent to delegate to — supervisor sends the error directly.
    pi.sendMessage(
      {
        customType: "agent_spawn_error" as const,
        content: `## ❌ Agent "${agentId}" spawn failed: ${prompt}\n\n${error.message}`,
        display: true,
      },
      { triggerTurn: false },
    );
  }
}
