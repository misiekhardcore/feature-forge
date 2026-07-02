import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SpecRegistry } from "../agents/specifications/SpecRegistry";
import { SpecLoader } from "./SpecLoader";

async function registerAll(loader: SpecLoader, registry: SpecRegistry): Promise<void> {
  const factoryMap = await loader.loadAll();
  for (const [name, factory] of factoryMap) {
    registry.register(name, factory);
  }
}

describe("SpecLoader", () => {
  let tempDir: string;
  let loader: SpecLoader;
  let registry: SpecRegistry;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), "spec-loader-test-"));
    loader = new SpecLoader(tempDir);
    registry = new SpecRegistry();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("loadAll", () => {
    it("loads a spec file and registers it under its frontmatter id", async () => {
      const specContent = `---
id: "test"
role: "test"
toolPreset: "fullAccess"
ephemeral: true
---
# Test Agent
`;
      await fs.writeFile(join(tempDir, "test.md"), specContent);

      await registerAll(loader, registry);

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
      await fs.writeFile(join(tempDir, "persona.md"), specContent);

      await registerAll(loader, registry);

      expect(registry.specNames()).toContain("implement");
      expect(registry.specNames()).not.toContain("persona");

      const spec = registry.create("implement");
      expect(spec.tools).toEqual(["run_build_loop", "bash"]);
    });

    it("loads multiple spec files", async () => {
      await fs.writeFile(
        join(tempDir, "build.md"),
        `---
id: "build"
role: "build"
toolPreset: "fullAccess"
ephemeral: true
---
# Build Agent
`,
      );
      await fs.writeFile(
        join(tempDir, "review.md"),
        `---
id: "review"
role: "review"
toolPreset: "reviewOnly"
ephemeral: true
---
# Review Agent
`,
      );

      await registerAll(loader, registry);

      expect(registry.specNames()).toContain("build");
      expect(registry.specNames()).toContain("review");

      expect(registry.create("build").tools).toContain("bash");
      expect(registry.create("review").tools).toEqual(["read", "grep"]);
    });

    it("throws when required metadata (id/role) is missing", async () => {
      await fs.writeFile(
        join(tempDir, "invalid.md"),
        `---
spec: "test"
---
# Test Agent
`,
      );

      await expect(loader.loadAll()).rejects.toThrow("id and role are required");
    });

    it("throws for an unknown tool preset", async () => {
      await fs.writeFile(
        join(tempDir, "bad.md"),
        `---
id: "bad"
role: "bad"
toolPreset: "nonexistent"
---
# Bad Agent
`,
      );

      await expect(loader.loadAll()).rejects.toThrow("Unknown tool preset");
    });

    it("throws when both toolPreset and tools are declared", async () => {
      await fs.writeFile(
        join(tempDir, "both.md"),
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

      await expect(loader.loadAll()).rejects.toThrow("declare only one of toolPreset or tools");
    });

    it("throws when neither toolPreset nor tools are declared", async () => {
      await fs.writeFile(
        join(tempDir, "neither.md"),
        `---
id: "neither"
role: "neither"
---
# Neither Agent
`,
      );

      await expect(loader.loadAll()).rejects.toThrow("toolPreset or tools is required");
    });

    it("resolves every named tool preset", async () => {
      const presets = [
        {
          name: "full",
          preset: "fullAccess",
          expected: ["read", "bash", "write", "edit", "grep", "ls"],
        },
        { name: "read", preset: "readOnly", expected: ["read", "grep", "ls"] },
        { name: "review", preset: "reviewOnly", expected: ["read", "grep"] },
        { name: "verify", preset: "verify", expected: ["read", "bash", "grep"] },
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

      await registerAll(loader, registry);

      for (const { name, expected } of presets) {
        expect(registry.create(name).tools).toEqual(expected);
      }
    });
  });

  describe("loadSpecFile", () => {
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

      const parsed = await loader.loadSpecFile(filepath);

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

      await expect(loader.loadSpecFile(filepath)).rejects.toThrow(/broken\.md/);
    });
  });
});
