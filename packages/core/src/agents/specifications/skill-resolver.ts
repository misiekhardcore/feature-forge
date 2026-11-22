import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

/**
 * Default forge home used when no forge homes are passed: `.forge`
 * resolved against the cwd. Kept for callers that predate the fixed-homes
 * cascade (e.g. `buildPiCliArguments` without homes); real callers thread
 * the project and global homes explicitly.
 */
const DEFAULT_FORGE_HOME = ".forge";

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
 * Scans `~/.agents/skills/`, `~/.pi/agent/skills/`, each threaded forge
 * home's `skills/` subdirectory (nearest home first), and the core
 * package's bundled `skills/` directory in priority order. Earlier
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
   * The per-user pi-level directories stay ahead of the forge homes
   * (ecosystem precedence), each forge home contributes its `skills/`
   * subdirectory in given order - nearest home first, so the project home
   * wins name collisions against the global home - and the bundled default
   * skills come last. Earlier directories take precedence if names
   * collide. Home-based paths are resolved at call time so `os.homedir()`
   * honors a runtime HOME override.
   */
  private static skillDirectories(forgeHomes: readonly string[] = []): string[] {
    return [
      path.join(os.homedir(), AGENTS_SKILLS_RELATIVE_DIR),
      path.join(os.homedir(), PI_AGENT_SKILLS_RELATIVE_DIR),
      // Each forge home's skills dir; missing entries are skipped silently
      // by the scanner (absence is the normal un-scaffolded state).
      ...forgeHomes.map((home) => path.resolve(home, "skills")),
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
   * @param forgeHomes - Optional forge homes scanned for skill paths,
   *   ordered nearest-first (project home, then global home). Each home's
   *   `skills/` subdirectory is scanned after the per-user pi-level
   *   directories and before the bundled defaults; earlier homes win name
   *   collisions. When omitted, a single default home (`.forge` resolved
   *   against the cwd) is scanned.
   * @returns Absolute paths to the effective set of SKILL.md files.
   */
  static resolveSkillPaths(
    skills: readonly string[],
    excludedSkills: readonly string[],
    forgeHomes?: readonly string[],
  ): string[] {
    const allSkills = this.discoverAllSkills(forgeHomes);
    const names = this.resolveEffectiveSkillNames(allSkills, skills, excludedSkills);

    return names.map((name) => allSkills.get(name)).filter((p): p is string => p !== undefined);
  }

  /**
   * Discover all available skill names by scanning well-known directories.
   *
   * @param forgeHomes - Optional forge homes scanned for skill paths,
   *   ordered nearest-first (project home, then global home); earlier
   *   homes win name collisions. When omitted or empty, a single default
   *   home (`.forge` resolved against the cwd) is scanned.
   * @returns A map of all discovered skill names to their SKILL.md paths.
   */
  static discoverAllSkills(forgeHomes?: readonly string[]): Map<string, string> {
    const nameMap = new Map<string, string>();

    const homes =
      forgeHomes && forgeHomes.length > 0 ? forgeHomes : [path.resolve(DEFAULT_FORGE_HOME)];
    for (const dir of this.skillDirectories(homes)) {
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
   * @param allSkills — Map of all discovered skill names.
   * @param skills — Allowlist (empty = all).
   * @param excludedSkills — Denylist (overrides allowlist).
   * @returns Effective skill names.
   */
  static resolveEffectiveSkillNames(
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

  /**
   * Resolve a skill directory's name from its SKILL.md frontmatter.
   *
   * Looks for a SKILL.md file in the given directory. If found, extracts
   * the `name` from YAML frontmatter, falling back to the directory
   * basename when the frontmatter carries no name. Returns `null` if no
   * SKILL.md exists, it cannot be read, or its frontmatter does not parse
   * - the directory is then not a skill.
   *
   * Public so callers that scan skill directories (e.g. the cli
   * `forge-skills` extension) share one name-resolution implementation
   * with this resolver instead of duplicating the frontmatter logic.
   */
  static resolveSkillName(skillDir: string): string | null {
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
   * Scan a directory tree for skill directories.
   *
   * The scanned directory is a container (a `skills/` root or a
   * grouping directory) whose subdirectories are discovered recursively:
   * a subdirectory that directly holds a SKILL.md is a skill root - it is
   * registered under its frontmatter `name` (or directory basename as
   * fallback) and NOT descended into, because everything below the
   * SKILL.md belongs to that one skill. A subdirectory without a direct
   * SKILL.md is a grouping directory (e.g. the bundled `review/*` family)
   * and is descended into to find skills at any depth. Dot directories
   * and `node_modules` are skipped, matching pi.
   *
   * In `~/.pi/agent/skills/`, also checks for root `.md` files whose
   * stem matches a skill name (filename-based resolution).
   */
  private static scanDirectory(dirPath: string, nameMap: Map<string, string>): void {
    this.scanSubdirectories(dirPath, nameMap);

    // In ~/.pi/agent/skills, also scan root .md files as skill definitions
    // (filename stem = skill name, for simple single-file skill specs)
    const piSkillsDir = path.join(os.homedir(), PI_AGENT_SKILLS_RELATIVE_DIR);
    if (dirPath === piSkillsDir) {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
      } catch {
        return;
      }
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

  /**
   * Recursively scan a container directory's subdirectories for skills.
   *
   * Each subdirectory is either a skill root (direct SKILL.md - register
   * it, do not descend) or a grouping directory (descend and repeat).
   */
  private static scanSubdirectories(dirPath: string, nameMap: Map<string, string>): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      // Directory doesn't exist or inaccessible - skip silently
      return;
    }

    // Deterministic first-wins inside one root: raw readdir order is
    // filesystem-dependent, so two same-named skills in one layer root
    // resolve alphabetically (SpecManager.loadFromDirectory sorts its
    // scan the same way).
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      // Dot directories and node_modules are never skill homes.
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }
      const childDir = path.join(dirPath, entry.name);
      if (!this.isDirectoryEntry(entry, childDir)) {
        continue;
      }
      if (this.hasDirectSkillMd(childDir)) {
        const name = this.resolveSkillName(childDir);
        if (name && !nameMap.has(name)) {
          nameMap.set(name, path.join(childDir, "SKILL.md"));
        }
        // Skill root - its contents below SKILL.md belong to that skill.
      } else {
        this.scanSubdirectories(childDir, nameMap);
      }
    }
  }

  /**
   * Whether a dirent is a directory, following symlinks like pi's own
   * loader: a dirent for a symlink reports neither isDirectory nor
   * isFile, so the link target is classified via statSync on the entry
   * path. A broken symlink (statSync throws) is not a directory - skipped
   * silently like the readdir catch above.
   */
  private static isDirectoryEntry(entry: fs.Dirent, entryPath: string): boolean {
    if (entry.isDirectory()) {
      return true;
    }
    if (!entry.isSymbolicLink()) {
      return false;
    }
    try {
      return fs.statSync(entryPath).isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Whether a directory directly holds a SKILL.md file (pi's marker for a
   * skill root: the loader registers the single skill and does not recurse
   * into its contents). A SKILL.md entry that is a symlink to a file also
   * qualifies - pi statSync-classifies its direct SKILL.md entry the same
   * way; a broken SKILL.md symlink does not.
   */
  private static hasDirectSkillMd(dir: string): boolean {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    return entries.some((entry) => {
      if (entry.name !== "SKILL.md") {
        return false;
      }
      if (entry.isFile()) {
        return true;
      }
      if (!entry.isSymbolicLink()) {
        return false;
      }
      try {
        return fs.statSync(path.join(dir, entry.name)).isFile();
      } catch {
        return false;
      }
    });
  }
}
