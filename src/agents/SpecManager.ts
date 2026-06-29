import type { SpecLoader } from "./declarative-specs/SpecLoader";
import type { AgentSpecification } from "./specifications/AgentSpecification";
import type { SpecRegistry } from "./specifications/SpecRegistry";

/**
 * Resolution params for constructing an {@link AgentSpecification} from a
 * named spec identifier plus runtime-supplied fields (tools, model, cwd).
 *
 * Unlike the IPC {@link SpawnAgentParams}, this type is only used internally
 * by callers that already know which named spec to load (e.g.
 * {@link AgentStepExecutor}, {@link ResearchCommand}).
 */
export interface SpecResolutionParams {
  /** Named spec identifier (e.g. "build", "review", "research"). */
  spec: string;
  /** Tool names to grant the agent. */
  toolNames: readonly string[];
  /** Optional model preference. */
  modelPreference?: string;
  /** Optional working directory. */
  cwd?: string;
}

/**
 * Owns specification construction — loading declarative specs and resolving
 * named spec identifiers into {@link AgentSpecification} instances.
 *
 * The IPC layer ({@link ParentSocketServer}) no longer uses this class;
 * it creates {@link DynamicAgentSpecification} directly from resolved params.
 * Internal callers (step executors, commands) use {@link resolve} when they
 * have a named spec to load.
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
   * Resolve a named spec identifier into a fully configured specification.
   *
   * Delegates to {@link SpecRegistry} for template rendering.
   * Falls back to {@link DynamicAgentSpecification} when the spec name is
   * not in the registry, built from the raw params.
   */
  resolve(params: SpecResolutionParams): AgentSpecification {
    if (this.registry.has(params.spec)) {
      return this.registry.create(params.spec);
    }

    throw new Error(`Spec '${params.spec}' not found`);
  }

  /**
   * Type guard that checks whether params carry a named spec identifier.
   *
   * Preserved for internal use by callers that may receive heterogeneous
   * params shapes and need to determine whether to resolve via the registry
   * or create a {@link DynamicAgentSpecification}.
   */
  static isSpecParams(params: SpecResolutionParams): boolean {
    return "spec" in params && typeof params.spec === "string";
  }
}
