import { describe, it, expect } from "vitest";
import { ResearchAgentSpecification } from "./index";

describe("ResearchAgentSpecification", () => {
  it("creates a spec with the researcher role", () => {
    const spec = new ResearchAgentSpecification();
    expect(spec.role).toBe("researcher");
  });

  it("creates a read-only agent with limited tools", () => {
    const spec = new ResearchAgentSpecification();
    expect(spec.toolNames).toEqual(["read", "grep", "ls"]);
  });

  it("creates an ephemeral agent", () => {
    const spec = new ResearchAgentSpecification();
    expect(spec.ephemeral).toBe(true);
  });

  it("shows the context section with empty values when no context is provided", () => {
    const spec = new ResearchAgentSpecification();
    expect(spec.systemPrompt).toContain("## Context");
    expect(spec.systemPrompt).not.toContain("Focus:");
    expect(spec.systemPrompt).not.toContain("Sources:");
  });

  it("injects focus into the system prompt when context is provided", () => {
    const spec = new ResearchAgentSpecification({ focus: "React hooks" });
    expect(spec.systemPrompt).toContain("Focus: React hooks");
  });

  it("injects sources into the system prompt when context includes sources", () => {
    const spec = new ResearchAgentSpecification({
      sources: ["src/components/", "src/hooks/"],
    });
    expect(spec.systemPrompt).toContain("Sources:");
    expect(spec.systemPrompt).toContain("- src/components/");
    expect(spec.systemPrompt).toContain("- src/hooks/");
  });

  it("injects both focus and sources when both are provided", () => {
    const spec = new ResearchAgentSpecification({
      focus: "performance",
      sources: ["src/utils/"],
    });
    expect(spec.systemPrompt).toContain("Focus: performance");
    expect(spec.systemPrompt).toContain("- src/utils/");
  });

  it("has read-only tools (not full access)", () => {
    const spec = new ResearchAgentSpecification();
    expect(spec.toolNames).not.toContain("bash");
    expect(spec.toolNames).not.toContain("write");
    expect(spec.toolNames).not.toContain("edit");
  });

  it("has a stable identifier regardless of context", () => {
    const spec1 = new ResearchAgentSpecification();
    const spec2 = new ResearchAgentSpecification({ focus: "anything" });
    expect(spec1.identifier.toString()).toBe(spec2.identifier.toString());
  });
});
