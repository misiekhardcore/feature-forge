import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

/** Default forge directory used when no explicit forgeDir is provided. */
const DEFAULT_FORGE_DIR = ".forge";

/** Per-user skill directory under `~/.agents/skills`. */
const AGENTS_SKILLS_RELATIVE_DIR = path.join(".agents", "skills");

/** pi agent skill directory under `~/.pi/agent/skills`. */
const PI_AGENT_SKILLS_RELATIVE_DIR = path.join(".pi", "agent", "skills");

interface SkillMetadata extends Record<string, unknown> {
  name?: string;
}

/**
 * Skill name discovery and allowlist/denylist resolution (no instance state).
 *
 * Scans `~/.agents/skills/`, `~/.pi/agent/skills/`, `<forgeDir>/skills/`, and
 * the core package's bundled `skills/` directory in priority order. Earlier
 * directories take precedence if names collide.
 *
 * The resolved paths can be passed to a pi subprocess via `--no-skills` +
 * `--skill <path>` flags to load only the required skills.
 */
export class SkillResolver {
  /** Static utility class - not instantiable. */
  private constructor() {}

  /**
   * Candidate locations of the bundled default skills shipped with the core
   * package. The tsup build emits a single `dist/index.js`, so `import.meta.url`
   * resolves to `dist` in the built bundle and to the source module directory
   * when running from source (vitest / tsx). At most one candidate exists per
   * layout; missing directories are skipped by the scanner.
   */
  static bundledSkillDirectories(): string[] {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    return [
      // Source layout: <pkg>/src/agents/specifications/../../skills
      path.resolve(moduleDir, "..", "..", "skills"),
      // Built bundle layout: <pkg>/dist/skills
      path.resolve(moduleDir, "skills"),
    ];
  }

  /**
   * Build the candidate skill directories in priority order.
   *
   * Earlier directories take precedence if names collide. Home-based paths are
   * resolved at call time so `os.homedir()` honors a runtime HOME override.
   */
  private static skillDirectories(forgeDir: string): string[] {
    return [
      path.join(os.homedir(), AGENTS_SKILLS_RELATIVE_DIR),
      path.join(os.homedir(), PI_AGENT_SKILLS_RELATIVE_DIR),
      path.resolve(forgeDir, "skills"),
      // Bundled default skills (lowest priority - user/project skills override)
      ...this.bundledSkillDirectories(),
    ];
  }

  /**
   * Resolve skill names to absolute SKILL.md paths by scanning well-known
   * skill directories.
   *
   * @param skills — Allowlist of skill names to include. Empty = include all discovered.
   * @param excludedSkills — Denylist of skill names to exclude. Overrides `skills`.
   * @param forgeDir — Optional forge directory path. When provided, scans
   *   `<forgeDir>/skills/` instead of the hardcoded `.forge/skills/`.
   * @returns Absolute paths to the effective set of SKILL.md files.
   */
  static resolveSkillPaths(
    skills: readonly string[],
    excludedSkills: readonly string[],
    forgeDir?: string,
  ): string[] {
    const allSkills = this.discoverAllSkills(forgeDir);
    const names = this.resolveEffectiveSkillNames(allSkills, skills, excludedSkills);

    return names.map((name) => allSkills.get(name)).filter((p): p is string => p !== undefined);
  }

  /**
   * Discover all available skill names by scanning well-known directories.
   *
   * @param forgeDir — Optional forge directory path.
   * @returns A map of all discovered skill names to their SKILL.md paths.
   */
  static discoverAllSkills(forgeDir?: string): Map<string, string> {
    const nameMap = new Map<string, string>();

    for (const dir of this.skillDirectories(forgeDir ?? DEFAULT_FORGE_DIR)) {
      this.scanDirectory(dir, nameMap);
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
   * An entry ending in `*` is a PREFIX pattern: "memo-*" matches every
   * discovered skill name starting with "memo-". Exact names keep working
   * alongside prefix patterns. Allowlist order is preserved; each prefix
   * pattern expands to every matching discovered name in discovery order.
   *
   * @param allSkills — Map of all discovered skill names.
   * @param skills — Allowlist (empty = all; `*`-suffix entries are prefixes).
   * @param excludedSkills — Denylist (overrides allowlist; `*`-suffix entries
   *   are prefixes too).
   * @returns Effective skill names.
   */
  static resolveEffectiveSkillNames(
    allSkills: Map<string, string>,
    skills: readonly string[],
    excludedSkills: readonly string[],
  ): string[] {
    const matches = (name: string, pattern: string): boolean =>
      pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : name === pattern;

    // Preserve allowlist order; expand prefix patterns to every matching
    // discovered name (deduped against earlier allowlist entries).
    const effectiveFrom: string[] = [];
    for (const pattern of skills) {
      for (const name of allSkills.keys()) {
        if (matches(name, pattern) && !effectiveFrom.includes(name)) effectiveFrom.push(name);
      }
    }
    const effective = skills.length > 0 ? effectiveFrom : [...allSkills.keys()];
    return effective.filter((name) => !excludedSkills.some((pattern) => matches(name, pattern)));
  }

  /**
   * Parse the frontmatter `name` field from a SKILL.md file.
   *
   * Looks for a SKILL.md file in the given directory. If found, extracts
   * the `name` from YAML frontmatter. Returns `null` if no SKILL.md exists
   * or it has no frontmatter name.
   */
  private static parseSkillName(skillDir: string): string | null {
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
  private static scanDirectory(dirPath: string, nameMap: Map<string, string>): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      // Directory doesn't exist or inaccessible - skip silently
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
    const piSkillsDir = path.join(os.homedir(), PI_AGENT_SKILLS_RELATIVE_DIR);
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
