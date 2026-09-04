import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeMockPiWithHandlers } from "../test-utils";
import { activateForgeSkills } from "./forge-skills";

/**
 * Fixture helpers mirror the composition-root layer layout: each layer is a
 * forge `skills/` root whose subdirectories are skills carrying a SKILL.md.
 */

/** Write a skill directory into a layer root; returns the SKILL.md path. */
function writeSkill(layerDir: string, dirName: string, frontmatterName?: string): string {
  const skillDir = path.join(layerDir, dirName);
  fs.mkdirSync(skillDir, { recursive: true });
  const name = frontmatterName ?? dirName;
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${name}\ndescription: test skill\n---\n`,
  );
  return path.join(skillDir, "SKILL.md");
}

/** Run the registered resources_discover handler and return its result. */
async function runDiscoverHandler(
  pi: ReturnType<typeof makeMockPiWithHandlers>,
): Promise<{ skillPaths?: string[] }> {
  return (await pi.getHandler("resources_discover")!()) as { skillPaths?: string[] };
}

describe("activateForgeSkills", () => {
  let tempDir: string;
  let projectLayer: string;
  let globalLayer: string;
  let packagedLayer: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-skills-ext-"));
    projectLayer = path.join(tempDir, "project", "skills");
    globalLayer = path.join(tempDir, "global", "skills");
    packagedLayer = path.join(tempDir, "packaged", "skills");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("contributes the nearest layer's SKILL.md when a skill exists in all three layers", async () => {
    fs.mkdirSync(projectLayer, { recursive: true });
    fs.mkdirSync(globalLayer, { recursive: true });
    fs.mkdirSync(packagedLayer, { recursive: true });
    const projectCopy = writeSkill(projectLayer, "demo");
    writeSkill(globalLayer, "demo");
    writeSkill(packagedLayer, "demo");

    const pi = makeMockPiWithHandlers();
    activateForgeSkills(pi, [projectLayer, globalLayer, packagedLayer]);

    const result = await runDiscoverHandler(pi);
    // Exactly one copy contributed, and it is the project (nearest) copy.
    expect(result.skillPaths).toEqual([projectCopy]);
  });

  it("keys skills by frontmatter name and falls back to the directory basename", async () => {
    fs.mkdirSync(projectLayer, { recursive: true });
    fs.mkdirSync(globalLayer, { recursive: true });
    fs.mkdirSync(packagedLayer, { recursive: true });
    // The project copy declares the skill under a dir name that differs from
    // its frontmatter name; the global copy relies on the dir-basename
    // fallback. Both resolve to the same name, so the project copy wins.
    const renamedProjectCopy = writeSkill(projectLayer, "renamed", "shared-name");
    writeSkill(globalLayer, "shared-name");
    // A packaged copy with no frontmatter name contributes via basename.
    const packagedBasenameCopy = writeSkill(packagedLayer, "basename-skill");

    const pi = makeMockPiWithHandlers();
    activateForgeSkills(pi, [projectLayer, globalLayer, packagedLayer]);

    const result = await runDiscoverHandler(pi);
    expect(result.skillPaths).toEqual([renamedProjectCopy, packagedBasenameCopy]);
  });

  it("contributes a skill unique to the global layer", async () => {
    fs.mkdirSync(globalLayer, { recursive: true });
    const globalCopy = writeSkill(globalLayer, "global-only");

    const pi = makeMockPiWithHandlers();
    activateForgeSkills(pi, [projectLayer, globalLayer, packagedLayer]);

    const result = await runDiscoverHandler(pi);
    expect(result.skillPaths).toEqual([globalCopy]);
  });

  it("contributes a skill unique to the packaged layer", async () => {
    fs.mkdirSync(packagedLayer, { recursive: true });
    const packagedCopy = writeSkill(packagedLayer, "packaged-only");

    const pi = makeMockPiWithHandlers();
    activateForgeSkills(pi, [projectLayer, globalLayer, packagedLayer]);

    const result = await runDiscoverHandler(pi);
    expect(result.skillPaths).toEqual([packagedCopy]);
  });

  it("skips layer directories that do not exist", async () => {
    // Only the project layer exists; the global and packaged layers are
    // never scaffolded (the normal un-scaffolded state).
    fs.mkdirSync(projectLayer, { recursive: true });
    const projectCopy = writeSkill(projectLayer, "project-only");

    const pi = makeMockPiWithHandlers();
    activateForgeSkills(pi, [projectLayer, globalLayer, packagedLayer]);

    const result = await runDiscoverHandler(pi);
    expect(result.skillPaths).toEqual([projectCopy]);
  });

  it("ignores non-skill directories and loose files inside a layer", async () => {
    fs.mkdirSync(projectLayer, { recursive: true });
    const projectCopy = writeSkill(projectLayer, "project-only");
    // A directory without a SKILL.md and a loose .md file are not skills.
    fs.mkdirSync(path.join(projectLayer, "no-skill-md"), { recursive: true });
    fs.writeFileSync(path.join(projectLayer, "loose.md"), "# not a skill\n");

    const pi = makeMockPiWithHandlers();
    activateForgeSkills(pi, [projectLayer, globalLayer, packagedLayer]);

    const result = await runDiscoverHandler(pi);
    expect(result.skillPaths).toEqual([projectCopy]);
  });

  it("discovers skills nested inside grouping directories within a layer", async () => {
    fs.mkdirSync(projectLayer, { recursive: true });
    // A grouping directory (no direct SKILL.md) holds skills one level
    // deeper, mirroring the bundled review/* layout in packaged scaffolds.
    const groupDir = path.join(projectLayer, "review");
    const architecturePath = writeSkill(groupDir, "architecture");
    const securityPath = writeSkill(groupDir, "security");

    const pi = makeMockPiWithHandlers();
    activateForgeSkills(pi, [projectLayer, globalLayer, packagedLayer]);

    const result = await runDiscoverHandler(pi);
    expect(result.skillPaths).toHaveLength(2);
    expect(result.skillPaths).toEqual(expect.arrayContaining([architecturePath, securityPath]));
  });

  it("returns unique paths with no duplicates across the layers", async () => {
    fs.mkdirSync(projectLayer, { recursive: true });
    fs.mkdirSync(globalLayer, { recursive: true });
    fs.mkdirSync(packagedLayer, { recursive: true });
    // "demo" appears in all three layers; the other names appear once each.
    const projectDemo = writeSkill(projectLayer, "demo");
    writeSkill(globalLayer, "demo");
    writeSkill(packagedLayer, "demo");
    const projectOnly = writeSkill(projectLayer, "project-only");
    const globalOnly = writeSkill(globalLayer, "global-only");
    const packagedOnly = writeSkill(packagedLayer, "packaged-only");

    const pi = makeMockPiWithHandlers();
    activateForgeSkills(pi, [projectLayer, globalLayer, packagedLayer]);

    const result = await runDiscoverHandler(pi);
    expect(result.skillPaths).toHaveLength(4);
    expect(new Set(result.skillPaths).size).toBe(result.skillPaths!.length);
    expect(result.skillPaths).toEqual(
      expect.arrayContaining([projectDemo, projectOnly, globalOnly, packagedOnly]),
    );
  });

  it("returns {} when no layer declares any skill", async () => {
    // All three layers exist but hold nothing skill-shaped.
    fs.mkdirSync(projectLayer, { recursive: true });
    fs.mkdirSync(globalLayer, { recursive: true });
    fs.mkdirSync(packagedLayer, { recursive: true });

    const pi = makeMockPiWithHandlers();
    activateForgeSkills(pi, [projectLayer, globalLayer, packagedLayer]);

    const result = await runDiscoverHandler(pi);
    expect(result).toEqual({});
  });

  it("follows a symlinked skill subdirectory into its target", async () => {
    fs.mkdirSync(projectLayer, { recursive: true });
    // The skill lives outside the layer and is symlinked in as a
    // subdirectory. A dirent for a symlink reports neither isDirectory
    // nor isFile, so the scan must statSync-follow it (pi's loader does)
    // or the skill is silently dropped. The contributed path is the link
    // path, not the resolved target.
    const externalDir = path.join(tempDir, "external", "linked-skill");
    writeSkill(path.join(tempDir, "external"), "linked-skill");
    fs.symlinkSync(externalDir, path.join(projectLayer, "linked-skill"), "dir");

    const pi = makeMockPiWithHandlers();
    activateForgeSkills(pi, [projectLayer, globalLayer, packagedLayer]);

    const result = await runDiscoverHandler(pi);
    expect(result.skillPaths).toEqual([path.join(projectLayer, "linked-skill", "SKILL.md")]);
  });

  it("treats a symlinked SKILL.md inside a skill dir as a skill root", async () => {
    fs.mkdirSync(projectLayer, { recursive: true });
    const skillDir = path.join(projectLayer, "file-linked-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    // The skill content lives elsewhere; only SKILL.md is symlinked in.
    // pi statSync-classifies its direct SKILL.md entry, so the dir is a
    // skill root and resolves through the link.
    const contentFile = path.join(tempDir, "skill-content.md");
    fs.writeFileSync(contentFile, "---\nname: file-linked-skill\ndescription: test skill\n---\n");
    fs.symlinkSync(contentFile, path.join(skillDir, "SKILL.md"), "file");

    const pi = makeMockPiWithHandlers();
    activateForgeSkills(pi, [projectLayer, globalLayer, packagedLayer]);

    const result = await runDiscoverHandler(pi);
    expect(result.skillPaths).toEqual([path.join(skillDir, "SKILL.md")]);
  });

  it("skips broken symlinks without dropping the layer's real skills", async () => {
    fs.mkdirSync(projectLayer, { recursive: true });
    const realCopy = writeSkill(projectLayer, "real-skill");
    // A dir symlink to a missing target and a skill dir whose SKILL.md
    // symlink is broken must be skipped (statSync throws), not throw.
    fs.symlinkSync(path.join(tempDir, "missing-dir"), path.join(projectLayer, "broken-dir"), "dir");
    const brokenMdDir = path.join(projectLayer, "broken-md");
    fs.mkdirSync(brokenMdDir, { recursive: true });
    fs.symlinkSync(path.join(tempDir, "missing.md"), path.join(brokenMdDir, "SKILL.md"), "file");

    const pi = makeMockPiWithHandlers();
    activateForgeSkills(pi, [projectLayer, globalLayer, packagedLayer]);

    const result = await runDiscoverHandler(pi);
    expect(result.skillPaths).toEqual([realCopy]);
  });

  it("resolves same-named skills in one layer deterministically (alphabetical first wins)", async () => {
    fs.mkdirSync(projectLayer, { recursive: true });
    // Created z-first so an unsorted readdir scan would likely return the
    // z copy first on common filesystems; the sorted scan always pins the
    // a copy as the winner.
    writeSkill(projectLayer, "z-dup", "dup-name");
    const aCopy = writeSkill(projectLayer, "a-dup", "dup-name");

    const pi = makeMockPiWithHandlers();
    activateForgeSkills(pi, [projectLayer, globalLayer, packagedLayer]);

    const result = await runDiscoverHandler(pi);
    expect(result.skillPaths).toEqual([aCopy]);
  });
});
