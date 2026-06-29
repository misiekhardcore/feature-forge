import type { SpecLoader } from "./declarative-specs/SpecLoader";
import type { AgentSpecification } from "./specifications/AgentSpecification";
import type { SpecRegistry } from "./specifications/SpecRegistry";

/**
 * Parameters for resolving a specification by named spec.
 *
 * Used internally by {@link AgentStepExecutor} and commands (e.g. ResearchCommand)
 * that look up named specs from the registry. The IPC layer no longer uses
 * this type — {@link ParentSocketServer} creates {@link DynamicAgentSpecification}
 * directly from IPC {@link SpawnAgentParams}.
 */
export interface SpecResolutionParams {
  [key: string]: unknown;
  /** Named spec identifier (e.g. "build", "review", "verify", "research"). */
  spec: string;
  /** Tool names to grant the agent. */
  tools?: readonly string[];
  /** Optional model preference. */
  model?: string;
  /** Optional working directory. */
  cwd?: string;
}

/**
 * Owns specification construction — loading declarative specs and resolving
 * named spec references into {@link AgentSpecification} instances.
 *
 * The IPC layer no longer depends on this class for spawning —
 * {@link ParentSocketServer} creates {@link DynamicAgentSpecification}
 * directly from resolved IPC params.
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
   * Resolve a named spec into a fully configured specification.
   *
   * Looks up the spec name in the registry and delegates to the registered
   * factory. For ad-hoc agents from IPC, use {@link DynamicAgentSpecification}
   * directly.
   */
  resolve(params: SpecResolutionParams): AgentSpecification {
    if (!this.registry.has(params.spec)) {
      throw new Error(`Spec '${params.spec}' not found`);
    }
    return this.registry.create(params.spec);
  }

  /**
   * Type guard: checks whether params come from a named spec flow.
   *
   * Used by internal callers (e.g. {@link AgentStepExecutor}) that may
   * resolve via either named specs or direct construction.
   */
  static isSpecParams(params: Record<string, unknown>): params is SpecResolutionParams {
    return "spec" in params && typeof params.spec === "string";
  }
}
