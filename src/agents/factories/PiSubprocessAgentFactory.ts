import { join } from "node:path";

import { getPackageDir, RpcClient, RpcClientOptions } from "@earendil-works/pi-coding-agent";

import { Agent, PiSubprocessAgent } from "../agents";
import { AgentSpecification } from "../specifications";
import { AgentCreationError, AgentFactory } from "./AgentFactory";
import { buildPiCliArguments } from "./helpers";

/**
 * Concrete AgentFactory that spawns agents as pi subprocesses in RPC mode.
 *
 * Child extension loading is deferred — use --extension flag or install
 * into .pi/extensions/ when delegation (sub-sub-agent spawning) is scoped.
 */
export class PiSubprocessAgentFactory extends AgentFactory {
  constructor(private readonly options: RpcClientOptions = {}) {
    super();
  }

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
    const args = [...(this.options.args ?? []), ...buildPiCliArguments(specification)];

    return new RpcClient({
      cliPath: this.options.cliPath ?? join(getPackageDir(), "dist/cli.js"),
      cwd: this.options.cwd ?? process.cwd(),
      model: specification.modelPreference ?? this.options.model,
      args,
      env: {
        ...this.options.env,
      },
    });
  }
}
