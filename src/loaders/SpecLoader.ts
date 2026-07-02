import * as fs from "node:fs/promises";
import * as path from "node:path";

import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

import { AgentSpecificationParams } from "../agents";
import { TOOL_PRESETS, ToolPresetName } from "../agents/specifications/constants";
import { DynamicAgentSpecification } from "../agents/specifications/DynamicAgentSpecification";
import type { SpecFactory } from "../agents/specifications/SpecRegistry";

/**
 * Metadata extracted from the frontmatter of a declarative spec file.
 *
 * Tooling is declared one of two ways:
 * - `toolPreset: "fullAccess"` — a named {@link TOOL_PRESETS} subset of
 *   built-in tools (used by sub-agent specs such as `build.md`).
 * - `tools: ["run_build_loop", "bash"]` — an explicit list, used by specs
 *   that name non-built-in extension/routine tools (e.g. an orchestrator
 *   persona). Exactly one of the two must be present.
 */
interface DeclarativeSpecMetadata extends AgentSpecificationParams, Record<string, unknown> {
  /** Unique identifier for the spec (e.g., "build", "implement"). */
  id: string;
  /** Role name used when spawning the agent (e.g., "build", "orchestrator"). */
  role: string;
  /** Name of a built-in tool preset. Mutually exclusive with {@link tools}. */
  toolPreset?: ToolPresetName;
  /** Explicit tool list (may include extension/routine tools). */
  tools?: string[];
  /** Whether the agent should be ephemeral (destroyed after use). */
  ephemeral?: boolean;
}

/** A parsed factory paired with the registry name it should be filed under. */
export interface ParsedSpec {
  name: string;
  factory: SpecFactory;
}

/**
 * Loads declarative agent specifications from markdown files with YAML
 * frontmatter.
 *
 * Each markdown file should have:
 * 1. YAML frontmatter with spec metadata (`id`, `role`, `toolPreset` *or*
 *    `tools`, `ephemeral`).
 * 2. A markdown body containing the system prompt.
 *
 * The spec is registered under its frontmatter `id` (not the filename stem),
 * so a flow's `orchestrator.md` with `id: "implement"` registers as
 * `"implement"` — symmetric with how `flow.json` agent steps reference specs
 * by name (`"build"`, `"review"`). See ADR 0007.
 */
export class SpecLoader {
  /**
   * Load a single spec file by absolute path.
   *
   * @param absolutePath — Absolute path to the markdown file.
   * @returns The parsed {@link ParsedSpec} so the caller can register it
   *   under its frontmatter `id`.
   */
  async load(absolutePath: string): Promise<ParsedSpec> {
    const content = await fs.readFile(absolutePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter<DeclarativeSpecMetadata>(content);

    if (!frontmatter.id || !frontmatter.role) {
      throw new Error(
        `Invalid spec metadata in ${path.basename(absolutePath)}: id and role are required`,
      );
    }

    const tools = this.resolveTools(frontmatter, absolutePath);
    const id = frontmatter.id ?? DynamicAgentSpecification.generateId(frontmatter);

    const factory: SpecFactory = () => {
      return new DynamicAgentSpecification({
        ...frontmatter,
        id,
        systemPrompt: body.trim(),
        tools,
      });
    };

    return { name: id, factory };
  }

  /**
   * Resolve the tool list from either a named preset or an explicit array.
   *
   * Exactly one of `toolPreset` / `tools` must be present; an error is thrown
   * if both or neither are declared.
   */
  private resolveTools(metadata: DeclarativeSpecMetadata, absolutePath: string): string[] {
    const label = path.basename(absolutePath);
    if (metadata.toolPreset && metadata.tools) {
      throw new Error(`Invalid spec metadata in ${label}: declare only one of toolPreset or tools`);
    }
    if (metadata.toolPreset) {
      return this.resolveToolPreset(metadata.toolPreset, label);
    }
    if (metadata.tools) {
      return [...metadata.tools];
    }
    throw new Error(`Invalid spec metadata in ${label}: toolPreset or tools is required`);
  }

  private resolveToolPreset(presetName: ToolPresetName, label: string): string[] {
    const preset = TOOL_PRESETS[presetName];
    if (!preset) {
      throw new Error(`Unknown tool preset in ${label}: ${presetName}`);
    }
    return [...preset];
  }
}
