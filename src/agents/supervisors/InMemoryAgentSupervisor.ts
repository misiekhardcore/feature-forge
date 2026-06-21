import { Agent } from "../agents";
import { AgentFactory } from "../factories";
import { AgentSpecification } from "../base";
import { AgentSupervisor } from "./AgentSupervisor";

/**
 * Concrete AgentSupervisor that tracks agents in an in-memory map.
 *
 * Spawning is delegated to the injected AgentFactory, but the supervisor
 * owns the lifecycle tracking — it can destroy individual agents or all
 * agents at once, and provides lookup by identifier.
 */
export class InMemoryAgentSupervisor extends AgentSupervisor {
  private readonly agents = new Map<string, Agent>();
  private readonly agentFactory: AgentFactory;

  constructor(agentFactory: AgentFactory) {
    super();
    this.agentFactory = agentFactory;
  }

  /**
   * Spawn a new agent via the injected factory and start tracking it.
   */
  public override async spawn(specification: AgentSpecification): Promise<Agent> {
    const agent = await this.agentFactory.create(specification);
    this.agents.set(agent.identifier.toString(), agent);
    return agent;
  }

  /**
   * Retrieve a tracked agent by its string identifier.
   */
  public override getAgent(agentIdentifier: string): Agent | undefined {
    return this.agents.get(agentIdentifier);
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
  public override async destroyAgent(agentIdentifier: string): Promise<void> {
    const agent = this.agents.get(agentIdentifier);
    if (!agent) {
      return;
    }
    await agent.destroy();
    this.agents.delete(agentIdentifier);
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
}
