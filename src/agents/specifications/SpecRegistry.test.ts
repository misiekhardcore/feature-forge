import { describe, expect, it } from "vitest";

import { BUILT_IN_TOOLS, TOOL_PRESETS } from "./constants";
import { DynamicAgentSpecification } from "./DynamicAgentSpecification";
import { SpecRegistry } from "./SpecRegistry";

describe("SpecRegistry", () => {
  it("is empty on construction", () => {
    const registry = new SpecRegistry();
    expect(Array.from(registry.specNames())).toEqual([]);
  });

  it("creates a build spec with configured properties", () => {
    const registry = new SpecRegistry();
    registry.register("build", () => {
      return new DynamicAgentSpecification({
        id: "build",
        role: "build",
        systemPrompt: "# Build Agent\n\nReady to build.",
        toolNames: [...TOOL_PRESETS.fullAccess],
        ephemeral: true,
      });
    });
    const spec = registry.create("build");
    expect(spec.role).toBe("build");
    expect(spec.systemPrompt).toBe("# Build Agent\n\nReady to build.");
    expect(spec.toolNames).toContain("read");
    expect(spec.toolNames).toContain("bash");
    expect(spec.toolNames).toContain("write");
    expect(spec.ephemeral).toBe(true);
  });

  it("creates a review spec with configured properties", () => {
    const registry = new SpecRegistry();
    registry.register("review", () => {
      return new DynamicAgentSpecification({
        id: "review",
        role: "review",
        systemPrompt: "# Review Agent\n\nReview the output.",
        toolNames: [...TOOL_PRESETS.reviewOnly],
        ephemeral: true,
      });
    });
    const spec = registry.create("review");
    expect(spec.role).toBe("review");
    expect(spec.systemPrompt).toBe("# Review Agent\n\nReview the output.");
    expect(spec.toolNames).toEqual(["read", "grep"]);
    expect(spec.ephemeral).toBe(true);
  });

  it("creates a verify spec with configured properties", () => {
    const registry = new SpecRegistry();
    registry.register("verify", () => {
      return new DynamicAgentSpecification({
        id: "verify",
        role: "verify",
        systemPrompt: "# Verify Agent\n\nVerify the output.",
        toolNames: [BUILT_IN_TOOLS.READ, BUILT_IN_TOOLS.BASH, BUILT_IN_TOOLS.GREP],
        ephemeral: true,
      });
    });
    const spec = registry.create("verify");
    expect(spec.role).toBe("verify");
    expect(spec.systemPrompt).toBe("# Verify Agent\n\nVerify the output.");
    expect(spec.toolNames).toContain("read");
    expect(spec.toolNames).toContain("bash");
    expect(spec.toolNames).not.toContain("write");
    expect(spec.ephemeral).toBe(true);
  });

  it("creates a research spec with configured properties", () => {
    const registry = new SpecRegistry();
    registry.register("research", () => {
      return new DynamicAgentSpecification({
        id: "research",
        role: "research",
        systemPrompt: "# Research Agent\n\n",
        toolNames: [...TOOL_PRESETS.readOnly],
        ephemeral: true,
      });
    });
    const spec = registry.create("research");
    expect(spec.role).toBe("research");
    expect(spec.systemPrompt).toBe("# Research Agent\n\n");
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
    registry.register("custom", () => {
      return new DynamicAgentSpecification({
        id: "custom",
        role: "helper",
        systemPrompt: "Custom prompt: testing",
        toolNames: ["read"],
        ephemeral: true,
      });
    });
    expect(registry.specNames()).toContain("custom");
    const spec = registry.create("custom");
    expect(spec.role).toBe("helper");
    expect(spec.systemPrompt).toBe("Custom prompt: testing");
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
