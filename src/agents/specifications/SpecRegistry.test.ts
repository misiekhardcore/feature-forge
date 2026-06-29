import { describe, expect, it } from "vitest";

import { BUILT_IN_TOOLS, TOOL_PRESETS } from "./constants";
import { DynamicAgentSpecification } from "./DynamicAgentSpecification";
import { SpecRegistry } from "./SpecRegistry";
import { fillTemplate } from "./templates";

describe("SpecRegistry", () => {
  it("is empty on construction", () => {
    const registry = new SpecRegistry();
    expect(Array.from(registry.specNames())).toEqual([]);
  });

  it("creates a build spec from the registered factory", () => {
    const registry = new SpecRegistry();
    registry.register("build", (params) => {
      return new DynamicAgentSpecification({
        id: "build",
        role: "build",
        systemPrompt: fillTemplate(
          "# Build Agent\n\nTask: {{TASK}}\nWorkspace: {{WORKSPACE}}",
          params,
        ),
        toolNames: [...TOOL_PRESETS.fullAccess],
        ephemeral: true,
      });
    });
    const spec = registry.create("build");
    expect(spec.role).toBe("build");
    expect(spec.systemPrompt).toContain("{{TASK}}");
    expect(spec.systemPrompt).toContain("{{WORKSPACE}}");
    expect(spec.toolNames).toContain("read");
    expect(spec.toolNames).toContain("bash");
    expect(spec.toolNames).toContain("write");
    expect(spec.ephemeral).toBe(true);
  });

  it("creates a review spec from the registered factory", () => {
    const registry = new SpecRegistry();
    registry.register("review", (params) => {
      return new DynamicAgentSpecification({
        id: "review",
        role: "review",
        systemPrompt: fillTemplate(
          "# Review Agent\n\nOutput: {{BUILD_OUTPUT}}\nCriteria: {{ACCEPTANCE_CRITERIA}}",
          params,
        ),
        toolNames: [...TOOL_PRESETS.reviewOnly],
        ephemeral: true,
      });
    });
    const spec = registry.create("review");
    expect(spec.role).toBe("review");
    expect(spec.systemPrompt).toContain("{{BUILD_OUTPUT}}");
    expect(spec.systemPrompt).toContain("{{ACCEPTANCE_CRITERIA}}");
    expect(spec.toolNames).toEqual(["read", "grep"]);
    expect(spec.ephemeral).toBe(true);
  });

  it("creates a verify spec from the registered factory", () => {
    const registry = new SpecRegistry();
    registry.register("verify", (params) => {
      return new DynamicAgentSpecification({
        id: "verify",
        role: "verify",
        systemPrompt: fillTemplate(
          "# Verify Agent\n\nOutput: {{BUILD_OUTPUT}}\nCriteria: {{ACCEPTANCE_CRITERIA}}",
          params,
        ),
        toolNames: [BUILT_IN_TOOLS.READ, BUILT_IN_TOOLS.BASH, BUILT_IN_TOOLS.GREP],
        ephemeral: true,
      });
    });
    const spec = registry.create("verify");
    expect(spec.role).toBe("verify");
    expect(spec.systemPrompt).toContain("{{BUILD_OUTPUT}}");
    expect(spec.toolNames).toContain("read");
    expect(spec.toolNames).toContain("bash");
    expect(spec.toolNames).not.toContain("write");
    expect(spec.ephemeral).toBe(true);
  });

  it("creates a research spec from the registered factory", () => {
    const registry = new SpecRegistry();
    registry.register("research", (params) => {
      return new DynamicAgentSpecification({
        id: "research",
        role: "research",
        systemPrompt: fillTemplate("# Research Agent\n\n{{CONTEXT}}", params),
        toolNames: [...TOOL_PRESETS.readOnly],
        ephemeral: true,
      });
    });
    const spec = registry.create("research");
    expect(spec.role).toBe("research");
    expect(spec.systemPrompt).toContain("{{CONTEXT}}");
    expect(spec.toolNames).toEqual(["read", "grep", "ls"]);
    expect(spec.ephemeral).toBe(true);
  });

  it("throws for unknown spec names", () => {
    const registry = new SpecRegistry();
    expect(() => registry.create("nonexistent")).toThrow('Unknown spec: "nonexistent"');
  });

  it("includes available specs in the error message", () => {
    const registry = new SpecRegistry();
    registry.register(
      "alpha",
      () =>
        new DynamicAgentSpecification({
          id: "alpha",
          role: "alpha",
          systemPrompt: "",
          toolNames: ["read"],
          ephemeral: true,
        }),
    );
    expect(() => registry.create("nonexistent")).toThrow(/Available specs:/);
    expect(() => registry.create("nonexistent")).toThrow(/alpha/);
  });

  it("works with empty params for all default specs", () => {
    const registry = new SpecRegistry();

    registry.register(
      "build",
      () =>
        new DynamicAgentSpecification({
          id: "build",
          role: "build",
          systemPrompt: "# Build Agent",
          toolNames: ["read"],
          ephemeral: true,
        }),
    );

    const build = registry.create("build");
    expect(build.role).toBe("build");
    expect(build.systemPrompt).toBe("# Build Agent");
  });

  it("allows registering custom specs", () => {
    const registry = new SpecRegistry();
    registry.register("custom", (params) => {
      return new DynamicAgentSpecification({
        id: "custom",
        role: params.ROLE ?? "custom",
        systemPrompt: `Custom prompt: ${params.TOPIC ?? ""}`,
        toolNames: ["read"],
        ephemeral: true,
      });
    });
    expect(registry.specNames()).toContain("custom");
    const spec = registry.create("custom");
    expect(spec.role).toBe("custom");
    expect(spec.systemPrompt).toBe("Custom prompt: ");
  });

  it("throws when registering a duplicate spec name", () => {
    const registry = new SpecRegistry();
    registry.register(
      "dup",
      () =>
        new DynamicAgentSpecification({
          id: "dup",
          role: "dup",
          systemPrompt: "dup",
          toolNames: ["read"],
          ephemeral: true,
        }),
    );
    const factory = (_params: Record<string, string>) =>
      new DynamicAgentSpecification({
        id: "dup",
        role: "dup",
        systemPrompt: "dup",
        toolNames: ["read"],
        ephemeral: true,
      });
    expect(() => registry.register("dup", factory)).toThrow("Spec already registered: dup");
  });
});
