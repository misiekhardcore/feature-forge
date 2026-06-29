import * as fs from "fs/promises";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SpecRegistry } from "../specifications/SpecRegistry";
import { SpecLoader } from "./SpecLoader";

describe("SpecLoader", () => {
  let tempDir: string;
  let loader: SpecLoader;
  let registry: SpecRegistry;

  beforeEach(async () => {
    // Create a temporary directory for test files
    tempDir = await fs.mkdtemp("/tmp/spec-loader-test-");
    loader = new SpecLoader(tempDir);
    // Create a new registry for clean testing (now starts empty by default)
    registry = new SpecRegistry();
  });

  afterEach(async () => {
    // Clean up temporary directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("loads spec files and registers them", async () => {
    // Create a test spec file
    const specContent = `---
id: "test"
role: "test"
spec: "test"
toolPreset: "fullAccess"
ephemeral: true
---
# Test Agent
`;
    await fs.writeFile(path.join(tempDir, "test.md"), specContent);

    // Load specs
    const factoryMap = await loader.loadAll();
    for (const [name, factory] of factoryMap) {
      registry.register(name, factory);
    }

    // Verify the spec was registered
    const specs = registry.specNames();
    expect(specs).toContain("test");

    // Verify we can create the spec
    const spec = registry.create("test");
    expect(spec.role).toBe("test");
    expect(spec.systemPrompt).toContain("# Test Agent");
    expect(spec.tools).toContain("read");
    expect(spec.tools).toContain("bash");
    expect(spec.tools).toContain("write");
    expect(spec.ephemeral).toBe(true);
  });

  it("loads multiple spec files", async () => {
    // Create multiple test spec files
    const buildSpec = `---
id: "build"
role: "build"
spec: "build"
toolPreset: "fullAccess"
ephemeral: true
---
# Build Agent
`;
    await fs.writeFile(path.join(tempDir, "build.md"), buildSpec);

    const reviewSpec = `---
id: "review"
role: "review"
spec: "review"
toolPreset: "reviewOnly"
ephemeral: true
---
# Review Agent
`;
    await fs.writeFile(path.join(tempDir, "review.md"), reviewSpec);

    // Load specs
    const factoryMap2 = await loader.loadAll();
    for (const [name, factory] of factoryMap2) {
      registry.register(name, factory);
    }

    // Verify both specs were registered
    const specs = registry.specNames();
    expect(specs).toContain("build");
    expect(specs).toContain("review");

    // Verify we can create both specs
    const buildSpecInstance = registry.create("build");
    expect(buildSpecInstance.role).toBe("build");
    expect(buildSpecInstance.tools).toContain("read");
    expect(buildSpecInstance.tools).toContain("bash");
    expect(buildSpecInstance.tools).toContain("write");

    const reviewSpecInstance = registry.create("review");
    expect(reviewSpecInstance.role).toBe("review");
    expect(reviewSpecInstance.tools).toEqual(["read", "grep"]);
  });

  it("throws for invalid spec file format", async () => {
    // Create an invalid spec file (missing frontmatter)
    const invalidSpec = `# Invalid Spec
No frontmatter here
`;
    await fs.writeFile(path.join(tempDir, "invalid.md"), invalidSpec);

    // Should throw when loading
    await expect(loader.loadAll()).rejects.toThrow("Invalid spec file format");
  });

  it("throws for missing required metadata", async () => {
    // Create a spec file with missing required fields
    const invalidSpec = `---
spec: "test"
# Missing id and toolPreset
---
# Test Agent
`;
    await fs.writeFile(path.join(tempDir, "invalid.md"), invalidSpec);

    // Should throw when loading
    await expect(loader.loadAll()).rejects.toThrow("id, role, and toolPreset are required");
  });

  it("resolves tool presets correctly", async () => {
    // Create spec files for each preset
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

    for (const { name, preset, expected: _expected } of presets) {
      const specContent = `---
id: "${name}"
role: "${name}"
spec: "${name}"
toolPreset: "${preset}"
ephemeral: true
---
# ${name} Agent
`;
      await fs.writeFile(path.join(tempDir, `${name}.md`), specContent);
    }

    // Load specs
    const factories3 = await loader.loadAll();
    for (const [name, factory] of factories3) {
      registry.register(name, factory);
    }

    // Verify each preset resolves correctly
    for (const { name, expected } of presets) {
      const spec = registry.create(name);
      expect(spec.tools).toEqual(expected);
    }
  });
});
