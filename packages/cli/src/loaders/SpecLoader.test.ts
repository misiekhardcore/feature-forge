import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SpecRegistry } from "../agents/specifications/SpecRegistry";
import { SpecLoader } from "./SpecLoader";

describe("SpecLoader", () => {
  let tempDir: string;
  let loader: SpecLoader;
  let registry: SpecRegistry;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), "spec-loader-test-"));
    loader = new SpecLoader();
    registry = new SpecRegistry();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("load", () => {
    it("loads a spec file and registers it under its frontmatter id", async () => {
      const filepath = join(tempDir, "test.md");
      const specContent = `---
id: "test"
role: "test"
toolPreset: "fullAccess"
ephemeral: true
---
# Test Agent
`;
      await fs.writeFile(filepath, specContent);

      const parsed = await loader.load(filepath);
      registry.register(parsed.name, parsed.factory);

      expect(registry.specNames()).toContain("test");

      const spec = registry.create("test");
      expect(spec.role).toBe("test");
      expect(spec.systemPrompt).toContain("# Test Agent");
      expect(spec.tools).toContain("read");
      expect(spec.tools).toContain("bash");
      expect(spec.tools).toContain("write");
      expect(spec.ephemeral).toBe(true);
    });

    it("registers under the frontmatter id, not the filename stem", async () => {
      const filepath = join(tempDir, "persona.md");
      const specContent = `---
id: "implement"
role: "orchestrator"
tools:
  - run_build_loop
  - bash
---
# Implement Orchestrator
`;
      // Filename stem ("persona") deliberately differs from id ("implement").
      await fs.writeFile(filepath, specContent);

      const parsed = await loader.load(filepath);
      registry.register(parsed.name, parsed.factory);

      expect(registry.specNames()).toContain("implement");
      expect(registry.specNames()).not.toContain("persona");

      const spec = registry.create("implement");
      expect(spec.tools).toEqual(["run_build_loop", "bash"]);
    });

    it("loads multiple spec files", async () => {
      const buildPath = join(tempDir, "build.md");
      await fs.writeFile(
        buildPath,
        `---
id: "build"
role: "build"
toolPreset: "fullAccess"
ephemeral: true
---
# Build Agent
`,
      );
      const reviewPath = join(tempDir, "review.md");
      await fs.writeFile(
        reviewPath,
        `---
id: "review"
role: "review"
toolPreset: "reviewOnly"
ephemeral: true
---
# Review Agent
`,
      );

      const buildParsed = await loader.load(buildPath);
      const reviewParsed = await loader.load(reviewPath);
      registry.register(buildParsed.name, buildParsed.factory);
      registry.register(reviewParsed.name, reviewParsed.factory);

      expect(registry.specNames()).toContain("build");
      expect(registry.specNames()).toContain("review");

      expect(registry.create("build").tools).toContain("bash");
      expect(registry.create("review").tools).toEqual(["read", "grep", "ls"]);
    });

    it("throws when required metadata (id/role) is missing", async () => {
      const filepath = join(tempDir, "invalid.md");
      await fs.writeFile(
        filepath,
        `---
spec: "test"
---
# Test Agent
`,
      );

      await expect(loader.load(filepath)).rejects.toThrow("id and role are required");
    });

    it("throws for an unknown tool preset", async () => {
      const filepath = join(tempDir, "bad.md");
      await fs.writeFile(
        filepath,
        `---
id: "bad"
role: "bad"
toolPreset: "nonexistent"
---
# Bad Agent
`,
      );

      await expect(loader.load(filepath)).rejects.toThrow("Unknown tool preset");
    });

    it("throws when both toolPreset and tools are declared", async () => {
      const filepath = join(tempDir, "both.md");
      await fs.writeFile(
        filepath,
        `---
id: "both"
role: "both"
toolPreset: "fullAccess"
tools:
  - bash
---
# Both Agent
`,
      );

      await expect(loader.load(filepath)).rejects.toThrow(
        "declare only one of toolPreset or tools",
      );
    });

    it("throws when neither toolPreset nor tools are declared", async () => {
      const filepath = join(tempDir, "neither.md");
      await fs.writeFile(
        filepath,
        `---
id: "neither"
role: "neither"
---
# Neither Agent
`,
      );

      await expect(loader.load(filepath)).rejects.toThrow("toolPreset or tools is required");
    });

    it("resolves every named tool preset", async () => {
      const presets = [
        {
          name: "full",
          preset: "fullAccess",
          expected: ["read", "bash", "write", "edit", "grep", "ls"],
        },
        { name: "read", preset: "readOnly", expected: ["read", "grep", "ls"] },
        { name: "review", preset: "reviewOnly", expected: ["read", "grep", "ls"] },
        { name: "verify", preset: "verify", expected: ["read", "bash", "grep", "ls"] },
      ];

      for (const { name, preset } of presets) {
        await fs.writeFile(
          join(tempDir, `${name}.md`),
          `---
id: "${name}"
role: "${name}"
toolPreset: "${preset}"
---
# ${name} Agent
`,
        );
      }

      for (const { name } of presets) {
        const parsed = await loader.load(join(tempDir, `${name}.md`));
        registry.register(parsed.name, parsed.factory);
      }

      for (const { name, expected } of presets) {
        expect(registry.create(name).tools).toEqual(expected);
      }
    });

    it("loads a single spec file by absolute path", async () => {
      const filepath = join(tempDir, "orchestrator.md");
      await fs.writeFile(
        filepath,
        `---
id: "implement"
role: "orchestrator"
tools:
  - run_build_loop
  - open_pr
  - bash
---
# Implement Orchestrator
`,
      );

      const parsed = await loader.load(filepath);

      expect(parsed.name).toBe("implement");
      registry.register(parsed.name, parsed.factory);

      const spec = registry.create("implement");
      expect(spec.role).toBe("orchestrator");
      expect(spec.systemPrompt).toContain("# Implement Orchestrator");
      expect(spec.tools).toEqual(["run_build_loop", "open_pr", "bash"]);
    });

    it("parses skills and excludedSkills from frontmatter", async () => {
      const filepath = join(tempDir, "skills-test.md");
      const specContent = `---
id: "skills-test"
role: "skills-test"
toolPreset: "fullAccess"
skills:
  - build
  - review
excludedSkills:
  - verify
---
# Skills Test Agent
`;
      await fs.writeFile(filepath, specContent);

      const parsed = await loader.load(filepath);
      registry.register(parsed.name, parsed.factory);

      const spec = registry.create("skills-test");
      expect(spec.skills).toEqual(["build", "review"]);
      expect(spec.excludedSkills).toEqual(["verify"]);
    });

    it("defaults skills and excludedSkills to empty arrays when not in frontmatter", async () => {
      const filepath = join(tempDir, "defaults-test.md");
      const specContent = `---
id: "defaults-test"
role: "defaults-test"
toolPreset: "fullAccess"
---
# Defaults Test Agent
`;
      await fs.writeFile(filepath, specContent);

      const parsed = await loader.load(filepath);
      registry.register(parsed.name, parsed.factory);

      const spec = registry.create("defaults-test");
      expect(spec.skills).toEqual([]);
      expect(spec.excludedSkills).toEqual([]);
    });

    it("passes single-element skill arrays correctly", async () => {
      const filepath = join(tempDir, "single-skill.md");
      const specContent = `---
id: "single-skill"
role: "single-skill"
toolPreset: "fullAccess"
skills:
  - research
---
# Single Skill Agent
`;
      await fs.writeFile(filepath, specContent);

      const parsed = await loader.load(filepath);
      registry.register(parsed.name, parsed.factory);

      const spec = registry.create("single-skill");
      expect(spec.skills).toEqual(["research"]);
    });

    it("build.md spec resolves with correct skills, toolPreset, and ephemeral", async () => {
      const filepath = join(tempDir, "build.md");
      const specContent = `---
id: "build"
role: "build"
toolPreset: "fullAccess"
ephemeral: true
skills:
  - "build"
---
# Build Agent
`;
      await fs.writeFile(filepath, specContent);

      const parsed = await loader.load(filepath);
      registry.register(parsed.name, parsed.factory);

      expect(parsed.name).toBe("build");

      const spec = registry.create("build");
      expect(spec.skills).toEqual(["build"]);
      expect(spec.ephemeral).toBe(true);
    });

    it("verify.md spec resolves with correct skills, toolPreset, and ephemeral", async () => {
      const filepath = join(tempDir, "verify.md");
      const specContent = `---
id: "verify"
role: "verify"
toolPreset: "verify"
ephemeral: true
skills:
  - "verify"
---
# Verify Agent
`;
      await fs.writeFile(filepath, specContent);

      const parsed = await loader.load(filepath);
      registry.register(parsed.name, parsed.factory);

      expect(parsed.name).toBe("verify");

      const spec = registry.create("verify");
      expect(spec.skills).toEqual(["verify"]);
      expect(spec.ephemeral).toBe(true);
    });

    it("reports the offending filename in errors", async () => {
      const filepath = join(tempDir, "broken.md");
      await fs.writeFile(
        filepath,
        `---
role: "no-id"
toolPreset: "fullAccess"
---
# No Id Agent
`,
      );

      await expect(loader.load(filepath)).rejects.toThrow(/broken\.md/);
    });
  });
});
