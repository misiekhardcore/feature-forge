import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { SpawnAgentParams } from "../ipc/messages";
import { logger } from "../logging";
import type {
  AgentSpecification,
  AgentSpecificationParams,
} from "./specifications/AgentSpecification";
import { DynamicAgentSpecification } from "./specifications/DynamicAgentSpecification";
import type { SpecLoader } from "./specifications/SpecLoader";
import type { SpecRegistry } from "./specifications/SpecRegistry";

/**
 * Parameters for resolving a specification by named spec.
 *
 * Used internally by {@link AgentStepExecutor} and commands (e.g. ResearchCommand)
 * that look up named specs from the registry.
 */
export interface SpecResolutionParams extends AgentSpecificationParams, Record<string, unknown> {
  /** Named spec identifier (e.g. "build", "review", "verify", "research"). */
  spec: string;
}

/**
 * Owns specification construction — loading declarative specs and resolving
 * both named spec references and ad-hoc IPC spawn params into
 * {@link AgentSpecification} instances.
 *
 * This keeps all spec creation in one place so the IPC layer
 * ({@link ParentSocketServer}) does not need to instantiate concrete
 * specification subclasses.
 */
export class SpecManager {
  constructor(
    private readonly registry: SpecRegistry,
    private readonly loader: SpecLoader,
  ) {}

  /**
   * Load every `*.md` declarative spec from a directory and register them.
   *
   * Specs are registered first-wins by their frontmatter `id`:
   * - **Within one call**: files are loaded in sorted filename order; when
   *   two files in the same directory declare the same id, the
   *   alphabetically first file wins, a warning is logged once per id, and
   *   the later duplicates are skipped - a duplicate inside a single
   *   directory is a layout error and should not race on registry state.
   *   The warning names what the registry actually keeps: the first file in
   *   this directory when its factory registered, or - when that id was
   *   already registered by an earlier loadFromDirectory call - the
   *   earlier layer's registry entry.
   * - **Across calls**: when the same id appears in several loaded
   *   directories, the first occurrence (in call order) wins and later
   *   duplicates are silent `registerIfAbsent` no-ops - the layer-cascade
   *   semantic, so registering directories in priority order (nearest
   *   layer first) never throws mid-directory on an overlap.
   *
   * A missing `specsDir` still throws; callers filter directories before
   * calling.
   */
  async loadFromDirectory(specsDir: string): Promise<void> {
    const files = await fs.readdir(specsDir);
    // Sorted so the first file per duplicated id is deterministic across
    // filesystems (raw readdir order is not).
    const mdFiles = files.filter((file) => file.endsWith(".md")).sort();

    const firstFileByName = new Map<string, string>();
    // Ids whose in-directory first file actually reached the registry in
    // this call. When an id was already registered by an earlier
    // loadFromDirectory call, registerIfAbsent returns false for the first
    // file too, so the registry keeps the earlier LAYER's factory - not the
    // first file in this directory - and the duplicate warning must say so.
    const registeredHere = new Set<string>();
    const warnedIds = new Set<string>();
    for (const file of mdFiles) {
      const parsed = await this.loader.load(path.join(specsDir, file));
      const firstFile = firstFileByName.get(parsed.name);
      if (firstFile !== undefined) {
        // One warning per duplicated id (not per duplicate file): a run of
        // three files sharing an id still logs a single line naming the
        // winner the registry keeps - the in-directory first file when its
        // factory registered, or the earlier layer's entry when this id
        // was already registered cross-call.
        if (!warnedIds.has(parsed.name)) {
          warnedIds.add(parsed.name);
          const kept = registeredHere.has(parsed.name)
            ? `keeping the first file in this directory ("${firstFile}")`
            : "keeping the spec registered by an earlier directory";
          logger.warn(
            `[feature-forge] Duplicate spec id "${parsed.name}" in ${specsDir} skipped, ` + kept,
          );
        }
        continue;
      }
      firstFileByName.set(parsed.name, file);
      if (this.registry.registerIfAbsent(parsed.name, parsed.factory)) {
        registeredHere.add(parsed.name);
      }
    }
  }

  /**
   * Resolve a named spec into a fully configured specification.
   *
   * Looks up the spec name in the registry and delegates to the registered
   * factory.
   */
  resolve(params: Pick<SpecResolutionParams, "spec">): AgentSpecification {
    if (!this.registry.has(params.spec)) {
      throw new Error(`Spec '${params.spec}' not found`);
    }
    return this.registry.create(params.spec);
  }

  /**
   * Create an ad-hoc {@link AgentSpecification} from resolved IPC params.
   *
   * All values are fully resolved before they reach this layer — no
   * template variables, no spec name lookups. The returned spec is a
   * {@link DynamicAgentSpecification}, which is tracked by the supervisor
   * after spawning, not registered for reuse.
   */
  createDynamic(params: SpawnAgentParams): AgentSpecification {
    return new DynamicAgentSpecification(params);
  }

  /**
   * Return a read-only set of registered spec names.
   *
   * Exposed so callers (e.g. {@link FlowRegistrar}) can snapshot the current
   * registry contents before validating flow references.
   */
  specNames(): ReadonlySet<string> {
    return this.registry.specNames();
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
