import * as fs from "fs/promises";
import * as yaml from "js-yaml";
import * as path from "path";

import { TOOL_PRESETS, ToolPresetName } from "../specifications/constants";
import { DynamicAgentSpecification } from "../specifications/DynamicAgentSpecification";
import type { SpecFactory } from "../specifications/SpecRegistry";
import { fillTemplate } from "../specifications/templates";

/**
 * Metadata extracted from the frontmatter of a declarative spec file.
 */
interface DeclarativeSpecMetadata {
  /** Unique identifier for the spec (e.g., "build", "review"). */
  id: string;
  /** Role name used when spawning the agent (e.g., "build", "reviewer"). */
  role: string;
  /** Name of the tool preset to use (e.g., "fullAccess", "reviewOnly"). */
  toolPreset: ToolPresetName;
  /** Whether the agent should be ephemeral (destroyed after use). */
  ephemeral: boolean;
  /** List of template parameter names that should be filled. */
  templateParams?: string[];
}

/**
 * Loads declarative agent specifications from markdown files with YAML frontmatter.
 *
 * Each markdown file should have:
 * 1. YAML frontmatter with spec metadata (id, spec, toolPreset, etc.)
 * 2. Markdown body containing the system prompt template
 *
 * @example
 * ```markdown
 * ---
 * id: "build"
 * spec: "build"
 * toolPreset: "fullAccess"
 * ephemeral: true
 * templateParams: ["TASK", "WORKSPACE"]
 * ---
 *
 * # Build Agent
 * Task: {{TASK}}
 * Workspace: {{WORKSPACE}}
 * ```
 */
export class SpecLoader {
  /**
   * Directory containing the declarative spec files.
   */
  private readonly specsDir: string;

  constructor(specsDir: string) {
    this.specsDir = specsDir;
  }

  /**
   * Load all declarative spec files from the directory.
   *
   * @returns A map of spec name to factory function.
   */
  async loadAll(): Promise<Map<string, SpecFactory>> {
    const factories = new Map<string, SpecFactory>();
    const files = await fs.readdir(this.specsDir);
    const mdFiles = files.filter((file) => file.endsWith(".md"));

    for (const file of mdFiles) {
      const specName = path.basename(file, ".md");
      const factory = await this.loadSpecFactory(file);
      factories.set(specName, factory);
    }

    return factories;
  }

  /**
   * Load a single spec file and create a factory function for it.
   *
   * @param filename — Name of the markdown file to load.
   * @returns A factory function that creates AgentSpecifications.
   */
  private async loadSpecFactory(filename: string): Promise<SpecFactory> {
    const filepath = path.join(this.specsDir, filename);
    const content = await fs.readFile(filepath, "utf-8");

    // Split frontmatter from content
    const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      throw new Error(`Invalid spec file format in ${filename}: missing frontmatter`);
    }

    const [, frontmatter, templateBody] = match;
    const metadata = yaml.load(frontmatter) as DeclarativeSpecMetadata;

    // Validate required fields
    if (!metadata.id || !metadata.role || !metadata.toolPreset) {
      throw new Error(
        `Invalid spec metadata in ${filename}: id, role, and toolPreset are required`,
      );
    }

    return (params: Record<string, string> = {}) => {
      // Resolve tool preset
      const toolNames = this.resolveToolPreset(metadata.toolPreset);

      // Fill template parameters
      const templateParams: Record<string, string> = {};
      if (metadata.templateParams) {
        for (const param of metadata.templateParams) {
          templateParams[param] = params[param] ?? "";
        }
      }

      // Use the template body directly from the markdown file
      const systemPrompt = fillTemplate(templateBody, templateParams);

      return new DynamicAgentSpecification({
        id: metadata.id,
        role: metadata.role,
        systemPrompt,
        toolNames,
        ephemeral: metadata.ephemeral,
      });
    };
  }

  /**
   * Resolve a tool preset name to an array of tool names.
   *
   * @param presetName — Name of the tool preset (e.g., "fullAccess").
   * @returns Array of tool names.
   */
  private resolveToolPreset(presetName: ToolPresetName): string[] {
    switch (presetName) {
      case "fullAccess":
        return [...TOOL_PRESETS.fullAccess];
      case "readOnly":
        return [...TOOL_PRESETS.readOnly];
      case "reviewOnly":
        return [...TOOL_PRESETS.reviewOnly];
      case "verify":
        return [...TOOL_PRESETS.verify];
      default:
        throw new Error(`Unknown tool preset: ${presetName}`);
    }
  }
}
