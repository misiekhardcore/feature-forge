import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SpecLoader } from "../loaders/SpecLoader";
import { toolListToRestrictions } from "../test-utils";
import { TOOL_PRESETS } from "./specifications/constants";
import { DynamicAgentSpecification } from "./specifications/DynamicAgentSpecification";
import { SpecRegistry } from "./specifications/SpecRegistry";
import { SpecManager } from "./SpecManager";

describe("SpecManager", () => {
  describe("isSpecParams", () => {
    it("returns true when params have a spec field", () => {
      const result = SpecManager.isSpecParams({
        spec: "build",
      });
      expect(result).toBe(true);
    });

    it("returns false when params have a role and systemPrompt instead of spec", () => {
      const result = SpecManager.isSpecParams({
        role: "custom",
        systemPrompt: "You are helpful",
      });
      expect(result).toBe(false);
    });

    it("returns false when spec is not a string", () => {
      const result = SpecManager.isSpecParams({
        spec: undefined,
      });
      expect(result).toBe(false);
    });
  });

  describe("resolve", () => {
    it("resolves a named spec from the registry", () => {
      const registry = new SpecRegistry();
      registry.register("build", () => {
        const restrictions: Record<string, readonly string[]> = {};
        for (const tool of TOOL_PRESETS.fullAccess) restrictions[tool] = [];
        return new DynamicAgentSpecification({
          id: "build",
          role: "build",
          systemPrompt: "Task: build",
          toolRestrictions: restrictions,
          ephemeral: true,
        });
      });
      const manager = new SpecManager(registry, new SpecLoader());

      const spec = manager.resolve({
        spec: "build",
      });

      expect(spec.id).toBe("build");
      expect(spec.role).toBe("build");
      expect(spec.systemPrompt).toBe("Task: build");
      expect(spec.ephemeral).toBe(true);
    });

    it("throws when named spec is not in the registry", () => {
      const registry = new SpecRegistry();
      const manager = new SpecManager(registry, new SpecLoader());

      expect(() =>
        manager.resolve({
          spec: "nonexistent",
        }),
      ).toThrow("Spec 'nonexistent' not found");
    });
  });

  describe("loadFromDirectory", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await fs.mkdtemp(join(tmpdir(), "spec-manager-test-"));
    });

    afterEach(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("loads specs from a directory and registers them in the registry", async () => {
      await fs.writeFile(
        join(tempDir, "research.md"),
        `---
id: "research"
role: "researcher"
toolPreset: "readOnly"
ephemeral: true
---
Research: default
`,
      );

      const registry = new SpecRegistry();
      const loader = new SpecLoader();
      const manager = new SpecManager(registry, loader);

      await manager.loadFromDirectory(tempDir);

      expect(registry.specNames()).toContain("research");
      const spec = registry.create("research");
      expect(spec.role).toBe("researcher");
      expect(spec.systemPrompt).toBe("Research: default");
    });

    it("loads multiple specs in one call", async () => {
      await fs.writeFile(
        join(tempDir, "build.md"),
        `---
id: "build"
role: "build"
toolPreset: "fullAccess"
ephemeral: true
---
Build: default
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
Review: default
`,
      );

      const registry = new SpecRegistry();
      const loader = new SpecLoader();
      const manager = new SpecManager(registry, loader);

      await manager.loadFromDirectory(tempDir);

      expect(Array.from(registry.specNames()).sort()).toEqual(["build", "review"]);
    });

    it("ignores non-markdown files", async () => {
      await fs.writeFile(
        join(tempDir, "build.md"),
        `---
id: "build"
role: "build"
toolPreset: "fullAccess"
---
Build
`,
      );
      await fs.writeFile(join(tempDir, "README.txt"), "not a spec");

      const registry = new SpecRegistry();
      const manager = new SpecManager(registry, new SpecLoader());

      await manager.loadFromDirectory(tempDir);

      expect(registry.specNames()).toContain("build");
      expect(registry.specNames()).not.toContain("README.txt");
    });
  });

  describe("specNames", () => {
    it("delegates to the registry", () => {
      const registry = new SpecRegistry();
      registry.register(
        "build",
        () =>
          new DynamicAgentSpecification({
            id: "build",
            role: "build",
            systemPrompt: "Task: build",
            toolRestrictions: toolListToRestrictions(TOOL_PRESETS.fullAccess),
            ephemeral: true,
          }),
      );
      const manager = new SpecManager(registry, new SpecLoader());

      expect(manager.specNames()).toEqual(new Set(["build"]));
    });
  });
});
