import { join } from "node:path";

import { getPackageDir, RpcClient, RpcClientOptions } from "@earendil-works/pi-coding-agent";

import { logger } from "../../logging";
import { PiSubprocessAgent, SubprocessAgent } from "../agents";
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

  public override async create(specification: AgentSpecification): Promise<SubprocessAgent> {
    const id = specification.id;
    const rpcClient = this.buildRpcClient(specification);

    const agent = new PiSubprocessAgent(id, specification, rpcClient);

    try {
      await agent.start();
    } catch (error) {
      logger.error("Factory creation failed", { specId: id, error });
      throw new AgentCreationError(
        id,
        `Failed to start RPC process`,
        error instanceof Error ? error : undefined,
      );
    }

    return agent;
  }

  private buildRpcClient(specification: AgentSpecification): RpcClient {
    const args = [...(this.options.args ?? []), ...buildPiCliArguments(specification)];

    return new RpcClient({
      cliPath: this.options.cliPath ?? join(getPackageDir(), "dist/cli.js"),
      cwd: specification.cwd ?? this.options.cwd ?? process.cwd(),
      model: specification.model ?? this.options.model,
      args,
      env: {
        ...this.options.env,
      },
    });
  }
}
