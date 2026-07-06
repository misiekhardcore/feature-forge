import { Registry } from "@feature-forge/shared";

import type { AgentSpecification } from "./AgentSpecification";

/**
 * Factory function that creates an {@link AgentSpecification}.
 *
 * The factory receives an empty params object — all configuration
 * is embedded in the factory closure. Template variables were removed
 * when specs transitioned to persona-only definitions.
 */
export type SpecFactory = (params: Record<string, string>) => AgentSpecification;

/**
 * Maps named spec identifiers to factory functions.
 *
 * Populated at startup by loading declarative markdown specs via
 * {@link SpecLoader} and registering each factory. Used by
 * {@link resolveSpecification} (or directly by {@link ParentSocketServer})
 * to construct agent specifications from LLM-provided spec names and
 * params, so the main agent can spawn sub-agents by name instead of
 * passing raw system prompt strings.
 *
 * @example
 * ```ts
 * const registry = new SpecRegistry();
 * registry.register("build", () => {
 *   return new DynamicAgentSpecification({ ... });
 * });
 * const spec = registry.create("build");
 * ```
 */
export class SpecRegistry extends Registry<SpecFactory> {
  /**
   * Register a named spec factory.
   *
   * @param name — identifier used by the LLM (e.g. "build", "review").
   * @param factory — creates an AgentSpecification, typically by loading a
   *   prompt template and filling its placeholders with the given params.
   * @throws if a spec with the same name is already registered.
   */
  register(name: string, factory: SpecFactory): void {
    if (this.has(name)) {
      throw new Error(`Spec already registered: ${name}`);
    }
    this.set(name, factory);
  }

  /**
   * Create an agent specification by name.
   *
   * @param name — a previously registered spec name.
   * @returns a fully configured AgentSpecification.
   * @throws if no spec is registered under the given name.
   */
  create(name: string): AgentSpecification {
    const factory = this.get(name);
    if (!factory) {
      const available = Array.from(this.specNames()).join(", ");
      throw new Error(
        `Unknown spec: "${name}". Available specs: ${available || "(none registered)"}`,
      );
    }
    return factory({});
  }

  /**
   * Return a read-only set of registered spec names.
   *
   * Suitable for dependency injection into components that only need
   * to check membership (e.g., FlowLoader spec validation).
   */
  specNames(): ReadonlySet<string> {
    return new Set(this.items.keys());
  }
}
