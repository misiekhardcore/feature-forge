import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { RpcClient, RpcClientOptions } from "@earendil-works/pi-coding-agent";

import { Agent, PiSubprocessAgent } from "../agents";
import { AgentSpecification } from "../specifications";
import { AgentCreationError, AgentFactory } from "./AgentFactory";
import { buildPiCliArguments } from "./helpers";

/**
 * Options for PiSubprocessAgentFactory.
 */
export interface PiSubprocessAgentFactoryOptions extends RpcClientOptions {
  /** Unix socket path from the parent's ParentSocketServer, passed to children via env. */
  forgeSocketPath?: string;
}

/**
 * Concrete AgentFactory that spawns agents as pi subprocesses in RPC mode.
 *
 * Injects the feature-forge extension (via --extension) so child processes
 * load the same extension as the parent. When FORGE_PARENT_SOCKET is set
 * in the environment, the extension also registers socket-backed tools
 * for sub-agent communication.
 */
export class PiSubprocessAgentFactory extends AgentFactory {
  /**
   * Resolve the forge extension path relative to this source file.
   * Defaults to resolving from __dirname.
   */
  private forgeExtensionPath: string = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "index.ts",
  );

  constructor(private readonly options: PiSubprocessAgentFactoryOptions = {}) {
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
    const args = [
      ...(this.options.args ?? []),
      "--extension",
      this.forgeExtensionPath,
      ...buildPiCliArguments(specification),
    ];

    return new RpcClient({
      cliPath: this.options.cliPath,
      cwd: this.options.cwd ?? process.cwd(),
      model: specification.modelPreference ?? this.options.model,
      args,
      env: {
        ...this.options.env,
        ...(this.options.forgeSocketPath
          ? { FORGE_PARENT_SOCKET: this.options.forgeSocketPath }
          : {}),
      },
    });
  }
}
