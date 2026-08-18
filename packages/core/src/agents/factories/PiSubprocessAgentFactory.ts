import { join } from "node:path";

import { getPackageDir, RpcClient, RpcClientOptions } from "@earendil-works/pi-coding-agent";
import { PiSubprocessAgent, SubprocessAgent } from "@feature-forge/core/src/agents";
import { AgentSpecification } from "@feature-forge/core/src/agents/specifications";
import { DynamicAgentSpecification } from "@feature-forge/core/src/agents/specifications/DynamicAgentSpecification";
import type { AgentModelConfig } from "@feature-forge/core/src/config";
import { resolveModel } from "@feature-forge/core/src/config";
import { logger } from "@feature-forge/core/src/logging";

import { AgentCreationError, AgentFactory } from "./AgentFactory";
import { buildPiCliArguments } from "./helpers";

/**
 * Concrete AgentFactory that spawns agents as pi subprocesses in RPC mode.
 *
 * Child extension loading is deferred — use --extension flag or install
 * into .pi/extensions/ when delegation (sub-sub-agent spawning) is scoped.
 */
export class PiSubprocessAgentFactory extends AgentFactory {
  constructor(
    private readonly options: RpcClientOptions = {},
    private readonly models: Readonly<Record<string, AgentModelConfig>> = {},
  ) {
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
    const resolvedModel = resolveModel(specification.model, this.models);

    // When the spec model is a preset name not found in the models map and no
    // presets are configured, don't force the unknown string onto pi — let pi
    // use its own default model instead.
    let effectiveModel = resolvedModel?.model;
    if (effectiveModel && !resolvedModel!.resolved && Object.keys(this.models).length === 0) {
      logger.warn("Model preset not configured, using pi default model", {
        specModel: specification.model,
      });
      effectiveModel = undefined;
    }

    // If the resolved model preset has a thinkingLevel and the spec doesn't
    // already have one, clone the spec with the preset's thinkingLevel applied.
    const effectiveSpec =
      resolvedModel?.thinkingLevel && !specification.thinkingLevel
        ? new DynamicAgentSpecification({
            ...specification.toJSON(),
            thinkingLevel: resolvedModel.thinkingLevel,
          })
        : specification;

    const args = [...(this.options.args ?? []), ...buildPiCliArguments(effectiveSpec)];

    return new RpcClient({
      cliPath: this.options.cliPath ?? join(getPackageDir(), "dist/cli.js"),
      cwd: effectiveSpec.cwd ?? this.options.cwd ?? process.cwd(),
      model: effectiveModel ?? this.options.model,
      provider: resolvedModel?.provider ?? this.options.provider,
      args,
      env: {
        ...this.options.env,
      },
    });
  }
}
