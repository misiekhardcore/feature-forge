import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "../logging";
import { toolListToRestrictions } from "../test-utils";
import { TOOL_PRESETS } from "./specifications/constants";
import { DynamicAgentSpecification } from "./specifications/DynamicAgentSpecification";
import { SpecLoader } from "./specifications/SpecLoader";
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

    it("keeps the first directory's factory when directories overlap on a spec id", async () => {
      const firstDir = join(tempDir, "first");
      const secondDir = join(tempDir, "second");
      await fs.mkdir(firstDir);
      await fs.mkdir(secondDir);
      await fs.writeFile(
        join(firstDir, "spec-a.md"),
        `---
id: "spec-a"
role: "researcher"
toolPreset: "readOnly"
ephemeral: true
---
First dir prompt
`,
      );
      await fs.writeFile(
        join(secondDir, "spec-a.md"),
        `---
id: "spec-a"
role: "researcher"
toolPreset: "readOnly"
ephemeral: true
---
Second dir prompt
`,
      );

      const registry = new SpecRegistry();
      const manager = new SpecManager(registry, new SpecLoader());

      await manager.loadFromDirectory(firstDir);
      // Overlapping id in a later (lower-priority) directory must not throw.
      await manager.loadFromDirectory(secondDir);

      expect(Array.from(registry.specNames())).toEqual(["spec-a"]);
      expect(registry.create("spec-a").systemPrompt).toBe("First dir prompt");
    });

    it("warns once and keeps the first file when files in one directory share an id", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      // Files load in sorted order: "a-spec.md" registers "dup-spec" first;
      // "b-spec.md" declares the same id and must be skipped with a warning
      // (no throw, no registry race), not silently ignored.
      await fs.writeFile(
        join(tempDir, "b-spec.md"),
        `---
id: "dup-spec"
role: "researcher"
toolPreset: "readOnly"
ephemeral: true
---
B file prompt
`,
      );
      await fs.writeFile(
        join(tempDir, "a-spec.md"),
        `---
id: "dup-spec"
role: "researcher"
toolPreset: "readOnly"
ephemeral: true
---
A file prompt
`,
      );

      const registry = new SpecRegistry();
      const manager = new SpecManager(registry, new SpecLoader());

      try {
        await manager.loadFromDirectory(tempDir);

        expect(Array.from(registry.specNames())).toEqual(["dup-spec"]);
        // The alphabetically first file wins.
        expect(registry.create("dup-spec").systemPrompt).toBe("A file prompt");
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Duplicate spec id "dup-spec"'),
        );
        // The warning names the kept (first) file so a duplicated layout can
        // be repaired without guessing which copy won.
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('keeping the first file in this directory ("a-spec.md")'),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("warns once per duplicated id across a run of duplicates", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      // Three files declare the same id: "a-spec.md" wins and both later
      // duplicates are skipped, but only ONE warning is emitted for the id.
      for (const file of ["c-spec.md", "b-spec.md", "a-spec.md"]) {
        await fs.writeFile(
          join(tempDir, file),
          `---
id: "dup-spec"
role: "researcher"
toolPreset: "readOnly"
ephemeral: true
---
${file} prompt
`,
        );
      }

      const registry = new SpecRegistry();
      const manager = new SpecManager(registry, new SpecLoader());

      try {
        await manager.loadFromDirectory(tempDir);

        expect(Array.from(registry.specNames())).toEqual(["dup-spec"]);
        expect(registry.create("dup-spec").systemPrompt).toBe("a-spec.md prompt");
        // Exactly one warning for the id, naming the alphabetically first file.
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Duplicate spec id "dup-spec"'),
        );
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('keeping the first file in this directory ("a-spec.md")'),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("warns that an earlier directory's spec is kept when a cross-call duplicate sits inside a later directory", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const firstDir = join(tempDir, "first");
      const secondDir = join(tempDir, "second");
      await fs.mkdir(firstDir);
      await fs.mkdir(secondDir);
      // "dup-spec" is registered by the FIRST dir's call, before the second
      // dir is ever loaded.
      await fs.writeFile(
        join(firstDir, "alpha.md"),
        `---
id: "dup-spec"
role: "researcher"
toolPreset: "readOnly"
ephemeral: true
---
First dir prompt
`,
      );
      // The second dir also holds two copies of the id. Its alphabetically
      // first file ("a-spec.md") loses the registry to the earlier layer
      // (registerIfAbsent no-op), so the duplicate warning must NOT claim
      // "keeping the first file in this directory" - the registry keeps the
      // earlier directory's factory.
      await fs.writeFile(
        join(secondDir, "b-spec.md"),
        `---
id: "dup-spec"
role: "researcher"
toolPreset: "readOnly"
ephemeral: true
---
B file prompt
`,
      );
      await fs.writeFile(
        join(secondDir, "a-spec.md"),
        `---
id: "dup-spec"
role: "researcher"
toolPreset: "readOnly"
ephemeral: true
---
A file prompt
`,
      );

      const registry = new SpecRegistry();
      const manager = new SpecManager(registry, new SpecLoader());

      try {
        await manager.loadFromDirectory(firstDir);
        await manager.loadFromDirectory(secondDir);

        expect(Array.from(registry.specNames())).toEqual(["dup-spec"]);
        // The registry keeps the earlier LAYER's factory, not the second
        // directory's alphabetically first file.
        expect(registry.create("dup-spec").systemPrompt).toBe("First dir prompt");
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('Duplicate spec id "dup-spec"'),
        );
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining("keeping the spec registered by an earlier directory"),
        );
        expect(warnSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('keeping the first file in this directory ("a-spec.md")'),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("registers a spec from a later directory when it is the only source", async () => {
      const firstDir = join(tempDir, "first");
      const secondDir = join(tempDir, "second");
      await fs.mkdir(firstDir);
      await fs.mkdir(secondDir);
      await fs.writeFile(
        join(firstDir, "other.md"),
        `---
id: "other"
role: "researcher"
toolPreset: "readOnly"
ephemeral: true
---
Other prompt
`,
      );
      await fs.writeFile(
        join(secondDir, "spec-a.md"),
        `---
id: "spec-a"
role: "researcher"
toolPreset: "readOnly"
ephemeral: true
---
Second dir prompt
`,
      );

      const registry = new SpecRegistry();
      const manager = new SpecManager(registry, new SpecLoader());

      await manager.loadFromDirectory(firstDir);
      await manager.loadFromDirectory(secondDir);

      expect(registry.specNames()).toContain("spec-a");
      expect(registry.create("spec-a").systemPrompt).toBe("Second dir prompt");
    });

    it("still throws when the directory does not exist", async () => {
      const registry = new SpecRegistry();
      const manager = new SpecManager(registry, new SpecLoader());

      await expect(manager.loadFromDirectory(join(tempDir, "missing"))).rejects.toThrow();
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
