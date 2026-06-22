import { describe, it, expect } from "vitest";
import { ResearchAgentSpecification } from "./ResearchAgentSpecification";

describe("ResearchAgentSpecification", () => {
  it("has identifier 'researcher'", () => {
    const spec = new ResearchAgentSpecification();
    expect(spec.identifier.toString()).toBe("researcher");
  });

  it("has role 'researcher'", () => {
    const spec = new ResearchAgentSpecification();
    expect(spec.role).toBe("researcher");
  });

  it("has a non-empty system prompt about investigation", () => {
    const spec = new ResearchAgentSpecification();
    expect(spec.systemPrompt).toContain("research agent");
    expect(spec.systemPrompt).toContain("read, grep, and ls");
  });

  it("has tools: read, grep, ls", () => {
    const spec = new ResearchAgentSpecification();
    expect(spec.toolNames).toEqual(["read", "grep", "ls"]);
  });

  it("is ephemeral", () => {
    const spec = new ResearchAgentSpecification();
    expect(spec.ephemeral).toBe(true);
  });

  it("does not disable built-in tools (only restricts via toolNames)", () => {
    const spec = new ResearchAgentSpecification();
    expect(spec.disableBuiltinTools).toBe(false);
  });

  it("has no excludeToolNames", () => {
    const spec = new ResearchAgentSpecification();
    expect(spec.excludeToolNames).toEqual([]);
  });
});
