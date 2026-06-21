import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Agent } from "../agents";
import { AgentFactory } from "../factories";
import { AgentSpecification } from "../specifications";
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

  /**
   * Full lifecycle: spawn → execute → agent delivers result/error → destroy.
   *
   * The agent owns its own result formatting and delivery (via pi.sendMessage).
   * The caller does not need to await this — the supervisor handles everything
   * internally (fire-and-forget safe).
   */
  public override async runAgent(
    specification: AgentSpecification,
    task: string,
    pi: ExtensionAPI,
  ): Promise<void> {
    const identifier = specification.identifier.toString();

    let agent: Agent;
    try {
      agent = await this.spawn(specification);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));

      return this.printAgentError(identifier, task, error, pi);
    }

    try {
      const result = await agent.executeTask(task);
      agent.deliverResult(task, result, pi);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      agent.deliverError(task, error, pi);
    } finally {
      await this.destroyAgent(identifier);
    }
  }

  printAgentError(agentIdentifier: string, task: string, error: Error, pi: ExtensionAPI): void {
    // No agent to delegate to — supervisor sends the error directly.
    pi.sendMessage(
      {
        customType: "agent_spawn_error" as const,
        content: `## ❌ Agent "${agentIdentifier}" spawn failed: ${task}\n\n${error.message}`,
        display: true,
      },
      { triggerTurn: false },
    );
  }
}
