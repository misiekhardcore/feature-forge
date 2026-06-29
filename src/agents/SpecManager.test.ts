import { describe, expect, it } from "vitest";

import type { SpecLoader } from "./declarative-specs/SpecLoader";
import { TOOL_PRESETS } from "./specifications/constants";
import { DynamicAgentSpecification } from "./specifications/DynamicAgentSpecification";
import { SpecRegistry } from "./specifications/SpecRegistry";
import { fillTemplate } from "./specifications/templates";
import { SpecManager } from "./SpecManager";

function makeLoader(
  specs: Record<
    string,
    {
      id: string;
      role: string;
      toolPreset: string;
      ephemeral?: boolean;
      body: string;
    }
  >,
): SpecLoader {
  return {
    loadAll: async () => {
      const map = new Map();
      for (const [name, spec] of Object.entries(specs)) {
        map.set(name, (_params: Record<string, string> = {}) => {
          return new DynamicAgentSpecification({
            id: spec.id,
            role: spec.role,
            systemPrompt: fillTemplate(spec.body, {}),
            toolNames: [...TOOL_PRESETS.fullAccess],
            ephemeral: spec.ephemeral ?? false,
          });
        });
      }
      return map;
    },
  } as unknown as SpecLoader;
}

describe("SpecManager", () => {
  describe("isSpecParams", () => {
    it("returns true when params have a spec field", () => {
      const result = SpecManager.isSpecParams({
        spec: "build",
        toolNames: ["read"],
      });
      expect(result).toBe(true);
    });

    it("returns false when params have a label and systemPrompt instead of spec", () => {
      const result = SpecManager.isSpecParams({
        label: "custom",
        systemPrompt: "You are helpful",
        tools: ["read"],
      });
      expect(result).toBe(false);
    });

    it("returns false when spec is not a string", () => {
      const result = SpecManager.isSpecParams({
        spec: undefined as unknown as string,
        toolNames: ["read"],
      });
      expect(result).toBe(false);
    });
  });

  describe("resolve", () => {
    it("resolves a named spec from the registry", () => {
      const registry = new SpecRegistry();
      registry.register("build", () => {
        return new DynamicAgentSpecification({
          id: "build",
          role: "build",
          systemPrompt: "Task: build",
          toolNames: [...TOOL_PRESETS.fullAccess],
          ephemeral: true,
        });
      });
      const loader = makeLoader({});
      const manager = new SpecManager(registry, loader);

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
      const loader = makeLoader({});
      const manager = new SpecManager(registry, loader);

      expect(() =>
        manager.resolve({
          spec: "nonexistent",
        }),
      ).toThrow("Spec 'nonexistent' not found");
    });
  });

  describe("load", () => {
    it("loads specs via the loader and registers them in the registry", async () => {
      const registry = new SpecRegistry();
      const loader = makeLoader({
        research: {
          id: "research",
          role: "researcher",
          toolPreset: "readOnly",
          ephemeral: true,
          body: "Research: default",
        },
      });
      const manager = new SpecManager(registry, loader);

      await manager.load();

      expect(registry.specNames()).toContain("research");
      const spec = registry.create("research");
      expect(spec.role).toBe("researcher");
      expect(spec.systemPrompt).toBe("Research: default");
    });

    it("loads multiple specs in one call", async () => {
      const registry = new SpecRegistry();
      const loader = makeLoader({
        build: {
          id: "build",
          role: "build",
          toolPreset: "fullAccess",
          ephemeral: true,
          body: "Build: default",
        },
        review: {
          id: "review",
          role: "review",
          toolPreset: "reviewOnly",
          ephemeral: true,
          body: "Review: default",
        },
      });
      const manager = new SpecManager(registry, loader);

      await manager.load();

      expect(Array.from(registry.specNames()).sort()).toEqual(["build", "review"]);
    });
  });
});
