import * as fs from "node:fs";
import * as path from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SkillResolver } from "@feature-forge/core/agents";

/**
 * Register a `resources_discover` handler that contributes the forge skill
 * cascade to the main session's skill discovery.
 *
 * `skillLayerDirs` are the forge skill roots, ordered nearest-first:
 * [project home skills, global home skills, packaged default skills] - the
 * same fixed-homes cascade the flows and agents use. Each layer directory
 * is scanned recursively for skill directories (a directory containing a
 * SKILL.md, at any depth - grouping directories like the bundled
 * `review/*` family hold their skills one level deeper); the nearest layer
 * that declares a skill name claims it. Skill names come
 * from {@link SkillResolver.resolveSkillName} - the single name-resolution
 * implementation shared with subagent skill resolution - so main-session
 * discovery and subagent resolution agree on names.
 *
 * Skill paths are contributed as the winning copy's individual SKILL.md
 * FILE path, not the layer directory. pi's skill loader is first-seen-wins
 * per name across the contributed paths and emits a collision diagnostic
 * for each later duplicate; contributing only the winning copy gives exact
 * nearest-wins precedence with zero collision noise. The loader accepts
 * both directories and .md file paths (verified in pi's loadSkills:
 * directory paths are scanned for skill subdirectories, .md file paths are
 * loaded as single skills), so a bare SKILL.md file contributes
 * identically to a directory scan of its containing skill dir.
 *
 * Missing layer dirs are skipped - absence is the normal un-scaffolded
 * state for the project/global homes. Returns {} when no layer declares
 * any skill.
 *
 * The layer dirs are resolved by the caller (the composition root) and
 * threaded in explicitly - this module never reads the config singleton.
 */
export function activateForgeSkills(pi: ExtensionAPI, skillLayerDirs: readonly string[]): void {
  pi.on("resources_discover", async (_event, _ctx) => {
    // Skill name -> winning SKILL.md path. First-wins across the ordered
    // layer dirs, so the nearest layer that declares a name claims it.
    const nameMap = new Map<string, string>();

    for (const layerDir of skillLayerDirs) {
      scanSkillLayer(layerDir, nameMap);
    }

    if (nameMap.size === 0) {
      return {};
    }
    return { skillPaths: [...nameMap.values()] };
  });
}

/**
 * Scan one forge skills root for skill directories, registering each
 * discovered skill in `nameMap` under its resolved name.
 *
 * Mirrors pi's own loader discovery rules (verified in pi's loadSkills): a
 * directory that directly contains a SKILL.md is a skill root - it is
 * registered and NOT descended into, because everything below the SKILL.md
 * belongs to that one skill. A directory without a direct SKILL.md is a
 * grouping directory (e.g. the bundled `review/*` family) and is descended
 * into to find skills at any depth. Dot directories and `node_modules`
 * are skipped, matching pi. Missing or unreadable roots are skipped
 * silently - absence is the normal un-scaffolded state.
 */
function scanSkillLayer(layerDir: string, nameMap: Map<string, string>): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(layerDir, { withFileTypes: true });
  } catch {
    return;
  }

  // Deterministic first-wins inside one layer: raw readdir order is
  // filesystem-dependent, so two same-named skills in one root resolve
  // alphabetically (SpecManager.loadFromDirectory sorts its scan the
  // same way).
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") {
      continue;
    }
    const childDir = path.join(layerDir, entry.name);
    if (!isDirectoryEntry(entry, childDir)) {
      continue;
    }
    if (hasDirectSkillMd(childDir)) {
      const name = SkillResolver.resolveSkillName(childDir);
      if (name && !nameMap.has(name)) {
        nameMap.set(name, path.join(childDir, "SKILL.md"));
      }
      // Skill root - its contents below SKILL.md belong to that skill.
    } else {
      scanSkillLayer(childDir, nameMap);
    }
  }
}

/**
 * Whether a dirent is a directory, following symlinks like pi's own
 * loader: a dirent for a symlink reports neither isDirectory nor isFile,
 * so the link target is classified via statSync on the entry path. A
 * broken symlink (statSync throws) is not a directory - skipped silently
 * like pi's readdir-catch tolerance.
 */
function isDirectoryEntry(entry: fs.Dirent, entryPath: string): boolean {
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
 * skill root: the loader registers the single skill and does not recurse).
 * A SKILL.md entry that is a symlink to a file also qualifies - pi
 * statSync-classifies its direct SKILL.md entry the same way; a broken
 * SKILL.md symlink does not.
 */
function hasDirectSkillMd(dir: string): boolean {
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
