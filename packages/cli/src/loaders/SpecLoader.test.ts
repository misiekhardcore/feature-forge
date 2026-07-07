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

    it("parses bash:pattern entries into bashAllowlist and strips to bash", async () => {
      const filepath = join(tempDir, "verify-restricted.md");
      await fs.writeFile(
        filepath,
        `---
id: "verify"
role: "verify"
tools:
  - read
  - "bash:npm run test:e2e"
  - "bash:npx vitest run"
  - grep
  - ls
---
# Verify Agent
`,
      );

      const parsed = await loader.load(filepath);
      registry.register(parsed.name, parsed.factory);

      const spec = registry.create("verify");
      expect(spec.tools).toEqual(["read", "bash", "grep", "ls"]);
      expect(spec.bashAllowlist).toEqual(["npm run test:e2e", "npx vitest run"]);
    });

    it("deduplicates bash when both plain bash and bash:pattern are present", async () => {
      const filepath = join(tempDir, "mixed-bash.md");
      await fs.writeFile(
        filepath,
        `---
id: "mixed"
role: "mixed"
tools:
  - bash
  - "bash:npm test"
---
# Mixed Agent
`,
      );

      const parsed = await loader.load(filepath);
      registry.register(parsed.name, parsed.factory);

      const spec = registry.create("mixed");
      expect(spec.tools).toEqual(["bash"]);
      expect(spec.bashAllowlist).toEqual(["npm test"]);
    });

    it("specs without bash:pattern have empty bashAllowlist", async () => {
      const filepath = join(tempDir, "plain-tools.md");
      await fs.writeFile(
        filepath,
        `---
id: "plain"
role: "plain"
tools:
  - read
  - bash
  - grep
---
# Plain Agent
`,
      );

      const parsed = await loader.load(filepath);
      registry.register(parsed.name, parsed.factory);

      const spec = registry.create("plain");
      expect(spec.tools).toEqual(["read", "bash", "grep"]);
      expect(spec.bashAllowlist).toEqual([]);
    });

    it("toolPreset specs have empty bashAllowlist", async () => {
      const filepath = join(tempDir, "preset-spec.md");
      await fs.writeFile(
        filepath,
        `---
id: "preset"
role: "preset"
toolPreset: "verify"
---
# Preset Agent
`,
      );

      const parsed = await loader.load(filepath);
      registry.register(parsed.name, parsed.factory);

      const spec = registry.create("preset");
      expect(spec.tools).toContain("bash");
      expect(spec.bashAllowlist).toEqual([]);
    });

    it("ignores empty bash: pattern", async () => {
      const filepath = join(tempDir, "empty-bash-pattern.md");
      await fs.writeFile(
        filepath,
        `---
id: "empty"
role: "empty"
tools:
  - "bash:"
  - read
---
# Empty Bash Pattern Agent
`,
      );

      const parsed = await loader.load(filepath);
      registry.register(parsed.name, parsed.factory);

      const spec = registry.create("empty");
      expect(spec.tools).toEqual(["bash", "read"]);
      expect(spec.bashAllowlist).toEqual([]);
    });

    it("multiple bash: patterns share single bash entry in tools", async () => {
      const filepath = join(tempDir, "multi-bash.md");
      await fs.writeFile(
        filepath,
        `---
id: "multi"
role: "multi"
tools:
  - "bash:git status"
  - "bash:git diff"
  - "bash:git log"
---
# Multi Bash Agent
`,
      );

      const parsed = await loader.load(filepath);
      registry.register(parsed.name, parsed.factory);

      const spec = registry.create("multi");
      expect(spec.tools).toEqual(["bash"]);
      expect(spec.bashAllowlist).toEqual(["git status", "git diff", "git log"]);
    });
  });
});
