import { RpcClient } from "@earendil-works/pi-coding-agent";
import { AgentCreationError, AgentFactory } from "./AgentFactory";
import { AgentSpecification } from "../base";
import { Agent, PiSubprocessAgent } from "../agents";

/**
 * Options for configuring how pi subprocess agents are spawned.
 */
export interface PiSubprocessAgentFactoryOptions {
  /**
   * Path to the pi CLI entry point.
   * Default: auto-detected by RpcClient.
   */
  readonly cliPath?: string;

  /**
   * Default working directory for spawned agents.
   * Default: process.cwd()
   */
  readonly defaultCwd?: string;

  /**
   * Additional CLI arguments passed to every spawned agent.
   */
  readonly defaultArgs?: readonly string[];
}

/**
 * Concrete AgentFactory that spawns agents as pi subprocesses in RPC mode.
 *
 * Each call to create() starts a new pi RPC process with the model and tools
 * specified in the AgentSpecification, and returns a PiSubprocessAgent handle.
 */
export class PiSubprocessAgentFactory extends AgentFactory {
  private readonly options: Required<PiSubprocessAgentFactoryOptions>;

  constructor(options: PiSubprocessAgentFactoryOptions = {}) {
    super();
    this.options = {
      cliPath: options.cliPath ?? "",
      defaultCwd: options.defaultCwd ?? process.cwd(),
      defaultArgs: options.defaultArgs ?? [],
    };
  }

  /**
   * Create and start a new pi subprocess agent.
   *
   * Steps:
   * 1. Build RpcClient from the specification
   * 2. Start the RPC process
   * 3. Return a PiSubprocessAgent handle
   */
  public override async create(specification: AgentSpecification): Promise<Agent> {
    const identifier = specification.identifier;
    const rpcClient = this.buildRpcClient(specification);

    const agent = new PiSubprocessAgent(identifier, specification, rpcClient);

    try {
      await agent.start();
    } catch (cause) {
      throw new AgentCreationError(
        identifier.toString(),
        `Failed to start RPC process`,
        cause instanceof Error ? cause : undefined,
      );
    }

    return agent;
  }

  private buildRpcClient(specification: AgentSpecification): RpcClient {
    return new RpcClient({
      cliPath: this.options.cliPath || undefined,
      cwd: this.options.defaultCwd,
      model: specification.modelPreference,
      args: [...this.options.defaultArgs],
    });
  }
}
