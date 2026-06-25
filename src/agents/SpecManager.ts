import type { SpawnAgentParams, SpawnAgentParamsWithSpec } from "../ipc/messages";
import type { SpecLoader } from "./declarative-specs/SpecLoader";
import type { AgentSpecification } from "./specifications/AgentSpecification";
import { DynamicAgentSpecification } from "./specifications/DynamicAgentSpecification";
import type { SpecRegistry } from "./specifications/SpecRegistry";

/**
 * Owns specification construction — loading declarative specs and resolving
 * raw IPC spawn params into {@link AgentSpecification} instances.
 *
 * Separates spec logic from the IPC layer ({@link ParentSocketServer}) and
 * from the plain storage ({@link SpecRegistry}).
 */
export class SpecManager {
  constructor(
    private readonly registry: SpecRegistry,
    private readonly loader: SpecLoader,
  ) {}

  /**
   * Load declarative specs from markdown files and register them.
   */
  async load(): Promise<void> {
    const factories = await this.loader.loadAll();
    for (const [name, factory] of factories) {
      this.registry.register(name, factory);
    }
  }

  /**
   * Resolve raw spawn params into a fully configured specification.
   *
   * When params include a named spec, delegates to the registry for
   * template rendering. Otherwise falls back to a
   * {@link DynamicAgentSpecification} built from the raw params.
   */
  resolve(params: SpawnAgentParams): AgentSpecification {
    if (SpecManager.isSpecParams(params)) {
      if (!this.registry.has(params.spec)) {
        throw new Error(`Spec '${params.spec}' not found`);
      }
      return this.registry.create(params.spec, params.specParams);
    }

    return new DynamicAgentSpecification({
      role: params.role,
      systemPrompt: params.systemPrompt,
      toolNames: params.toolNames,
      modelPreference: params.model,
      cwd: params.cwd,
    });
  }

  static isSpecParams(params: SpawnAgentParams): params is SpawnAgentParamsWithSpec {
    return "spec" in params && typeof params.spec === "string";
  }
}
