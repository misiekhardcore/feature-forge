import { describe, expect, it } from "vitest";

import type { SpawnAgentParams } from "../ipc/messages";
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
      templateParams?: string[];
      body: string;
    }
  >,
): SpecLoader {
  return {
    loadAll: async () => {
      const map = new Map();
      for (const [name, spec] of Object.entries(specs)) {
        map.set(name, (params: Record<string, string> = {}) => {
          return new DynamicAgentSpecification({
            id: spec.id,
            role: spec.role,
            systemPrompt: fillTemplate(spec.body, params),
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

    it("returns false when params have a role and systemPrompt instead of spec", () => {
      const result = SpecManager.isSpecParams({
        role: "custom",
        systemPrompt: "You are helpful",
        toolNames: ["read"],
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
      registry.register("build", (params) => {
        return new DynamicAgentSpecification({
          id: "build",
          role: "build",
          systemPrompt: fillTemplate("Task: {{TASK}}", params),
          toolNames: [...TOOL_PRESETS.fullAccess],
          ephemeral: true,
        });
      });
      const loader = makeLoader({});
      const manager = new SpecManager(registry, loader);

      const spec = manager.resolve({
        spec: "build",
        specParams: { TASK: "Add login" },
        toolNames: ["read"],
      });

      expect(spec.id).toBe("build");
      expect(spec.role).toBe("build");
      expect(spec.systemPrompt).toBe("Task: Add login");
      expect(spec.ephemeral).toBe(true);
    });

    it("throws when named spec is not in the registry", () => {
      const registry = new SpecRegistry();
      const loader = makeLoader({});
      const manager = new SpecManager(registry, loader);

      expect(() =>
        manager.resolve({
          spec: "nonexistent",
          toolNames: ["read"],
        }),
      ).toThrow("Spec 'nonexistent' not found");
    });

    it("falls back to DynamicAgentSpecification when no spec is provided", () => {
      const registry = new SpecRegistry();
      const loader = makeLoader({});
      const manager = new SpecManager(registry, loader);

      const spec = manager.resolve({
        role: "custom",
        systemPrompt: "You are a custom agent",
        toolNames: ["read", "bash"],
      });

      expect(spec.role).toBe("custom");
      expect(spec.systemPrompt).toBe("You are a custom agent");
      expect(spec.toolNames).toEqual(["read", "bash"]);
    });

    it("passes model preference through in fallback mode", () => {
      const registry = new SpecRegistry();
      const loader = makeLoader({});
      const manager = new SpecManager(registry, loader);

      const spec = manager.resolve({
        role: "researcher",
        systemPrompt: "Research",
        toolNames: ["read"],
        model: "claude-sonnet-4-5",
      });

      expect(spec.role).toBe("researcher");
      expect(spec.modelPreference).toBe("claude-sonnet-4-5");
    });

    it("passes cwd through in fallback mode", () => {
      const registry = new SpecRegistry();
      const loader = makeLoader({});
      const manager = new SpecManager(registry, loader);

      const spec = manager.resolve({
        role: "worker",
        systemPrompt: "Work",
        toolNames: ["bash"],
        cwd: "/tmp/workspace",
      });

      expect(spec.cwd).toBe("/tmp/workspace");
    });

    it("does not pass model or cwd through named spec path (registry handles it)", () => {
      const registry = new SpecRegistry();
      registry.register("build", (params) => {
        return new DynamicAgentSpecification({
          id: "build",
          role: "build",
          systemPrompt: fillTemplate("{{TASK}}", params),
          toolNames: [...TOOL_PRESETS.fullAccess],
          ephemeral: true,
        });
      });
      const loader = makeLoader({});
      const manager = new SpecManager(registry, loader);

      // model and cwd passed alongside spec but registry factory ignores them by design
      const spec = manager.resolve({
        spec: "build",
        specParams: { TASK: "test" },
        toolNames: ["read"],
        model: "claude-opus",
        cwd: "/other",
      } as SpawnAgentParams);

      // Registry factory didn't set modelPreference or cwd, so they remain undefined
      expect(spec.modelPreference).toBeUndefined();
      expect(spec.cwd).toBeUndefined();
      expect(spec.systemPrompt).toBe("test");
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
          templateParams: ["CONTEXT"],
          body: "Research: {{CONTEXT}}",
        },
      });
      const manager = new SpecManager(registry, loader);

      await manager.load();

      expect(registry.list()).toContain("research");
      const spec = registry.create("research", { CONTEXT: "test context" });
      expect(spec.role).toBe("researcher");
      expect(spec.systemPrompt).toBe("Research: test context");
    });

    it("loads multiple specs in one call", async () => {
      const registry = new SpecRegistry();
      const loader = makeLoader({
        build: {
          id: "build",
          role: "build",
          toolPreset: "fullAccess",
          ephemeral: true,
          templateParams: ["TASK"],
          body: "Build: {{TASK}}",
        },
        review: {
          id: "review",
          role: "review",
          toolPreset: "reviewOnly",
          ephemeral: true,
          templateParams: ["OUTPUT"],
          body: "Review: {{OUTPUT}}",
        },
      });
      const manager = new SpecManager(registry, loader);

      await manager.load();

      expect(registry.list()).toEqual(["build", "review"]);
    });
  });
});
