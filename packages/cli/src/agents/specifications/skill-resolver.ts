import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

interface SkillMetadata extends Record<string, unknown> {
  name?: string;
}

/**
 * Resolves skill names to absolute SKILL.md paths by scanning well-known
 * skill directories.
 *
 * Scans `~/.agents/skills/`, `~/.pi/agent/skills/`, and `.forge/skills/`
 * in priority order. Earlier directories take precedence if names collide.
 *
 * The resolved paths can be passed to a pi subprocess via `--no-skills` +
 * `--skill <path>` flags to load only the required skills.
 */
export class SkillResolver {
  /**
   * Resolve skill names to absolute SKILL.md paths.
   *
   * @param skills — Allowlist of skill names to include. Empty = include all discovered.
   * @param excludedSkills — Denylist of skill names to exclude. Overrides `skills`.
   * @returns Absolute paths to the effective set of SKILL.md files.
   */
  static resolvePaths(skills: readonly string[], excludedSkills: readonly string[]): string[] {
    const allSkills = this.discoverAll();
    const names = this.resolveEffectiveNames(allSkills, skills, excludedSkills);

    return names.map((name) => allSkills.get(name)).filter((p): p is string => p !== undefined);
  }

  /**
   * Discover all available skill names by scanning well-known directories.
   *
   * @returns A map of all discovered skill names to their SKILL.md paths.
   */
  static discoverAll(): Map<string, string> {
    const nameMap = new Map<string, string>();
    const resolver = new SkillResolver();

    for (const dir of resolver.skillDirectories()) {
      resolver.scanDirectory(dir, nameMap);
    }

    return nameMap;
  }

  /**
   * Compute the effective set of skill names given allowlist and denylist.
   *
   * - Empty `skills` → use all discovered names
   * - Non-empty `skills` → use only those (minus excluded)
   * - `excludedSkills` always overrides (subtracted from effective set)
   *
   * @param allSkills — Map of all discovered skill names.
   * @param skills — Allowlist (empty = all).
   * @param excludedSkills — Denylist (overrides allowlist).
   * @returns Effective skill names.
   */
  static resolveEffectiveNames(
    allSkills: Map<string, string>,
    skills: readonly string[],
    excludedSkills: readonly string[],
  ): string[] {
    const excludedSet = new Set(excludedSkills);

    // If no allowlist, use all discovered minus excluded
    const effectiveFrom =
      skills.length > 0 ? skills.filter((name) => allSkills.has(name)) : [...allSkills.keys()];

    return effectiveFrom.filter((name) => !excludedSet.has(name));
  }

  private skillDirectories(): string[] {
    return [
      path.join(os.homedir(), ".agents", "skills"),
      path.join(os.homedir(), ".pi", "agent", "skills"),
      path.resolve(".forge", "skills"),
    ];
  }

  /**
   * Parse the frontmatter `name` field from a SKILL.md file.
   *
   * Looks for a SKILL.md file in the given directory. If found, extracts
   * the `name` from YAML frontmatter. Returns `null` if no SKILL.md exists
   * or it has no frontmatter name.
   */
  private parseSkillName(skillDir: string): string | null {
    const skillMdPath = path.join(skillDir, "SKILL.md");
    try {
      const content = fs.readFileSync(skillMdPath, "utf-8");
      const { frontmatter } = parseFrontmatter<SkillMetadata>(content);
      if (frontmatter?.name && typeof frontmatter.name === "string") {
        return frontmatter.name;
      }
      // Fallback: use directory basename as the name
      return path.basename(skillDir);
    } catch {
      // Not a valid skill directory or file read error
      return null;
    }
  }

  /**
   * Scan a single directory for skill subdirectories.
   *
   * Each subdirectory containing a SKILL.md is registered in the map
   * under its frontmatter `name` (or directory basename as fallback).
   *
   * In `~/.pi/agent/skills/`, also checks for root `.md` files whose
   * stem matches a skill name (filename-based resolution).
   */
  private scanDirectory(dirPath: string, nameMap: Map<string, string>): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      // Directory doesn't exist or inaccessible — skip silently
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillDir = path.join(dirPath, entry.name);
        const name = this.parseSkillName(skillDir);
        if (name && !nameMap.has(name)) {
          nameMap.set(name, path.join(skillDir, "SKILL.md"));
        }
      }
    }

    // In ~/.pi/agent/skills/, also scan root .md files as skill definitions
    // (filename stem = skill name, for simple single-file skill specs)
    const piSkillsDir = path.join(os.homedir(), ".pi", "agent", "skills");
    if (dirPath === piSkillsDir) {
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "SKILL.md") {
          const stem = entry.name.slice(0, -3); // Remove ".md"
          if (!nameMap.has(stem)) {
            nameMap.set(stem, path.join(dirPath, entry.name));
          }
        }
      }
    }
  }
}
