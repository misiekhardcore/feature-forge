import { fileURLToPath } from "node:url";
import { RpcClient, RpcClientOptions } from "@earendil-works/pi-coding-agent";
import { AgentCreationError, AgentFactory } from "./AgentFactory";
import { AgentSpecification } from "../base";
import { Agent, PiSubprocessAgent } from "../agents";
import { buildPiCliArguments } from "./helpers.js";

function resolvePiCliPath(): string {
  const piIndexUrl = import.meta.resolve("@earendil-works/pi-coding-agent");
  const piIndexPath = fileURLToPath(piIndexUrl);
  return piIndexPath.replace(/index\.js$/, "cli.js");
}

/**
 * Concrete AgentFactory that spawns agents as pi subprocesses in RPC mode.
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
      cliPath: this.options.cliPath ?? resolvePiCliPath(),
      cwd: this.options.cwd ?? process.cwd(),
      model: specification.modelPreference,
      args,
    });
  }
}
