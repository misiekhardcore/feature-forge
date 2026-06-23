import { describe, expect, it } from "vitest";

import { fillTemplate, loadPromptTemplate } from "./templates";

describe("fillTemplate()", () => {
  it("replaces a single placeholder with the provided value", () => {
    const result = fillTemplate("Hello {{NAME}}!", { NAME: "World" });
    expect(result).toBe("Hello World!");
  });

  it("replaces multiple unique placeholders", () => {
    const result = fillTemplate("{{GREETING}}, {{TARGET}}!", {
      GREETING: "Hi",
      TARGET: "Alice",
    });
    expect(result).toBe("Hi, Alice!");
  });

  it("replaces repeated occurrences of the same placeholder", () => {
    const result = fillTemplate("{{X}} + {{X}} = {{Y}}", { X: "1", Y: "2" });
    expect(result).toBe("1 + 1 = 2");
  });

  it("leaves unknown placeholders unchanged", () => {
    const result = fillTemplate("Hello {{NAME}}!", {});
    expect(result).toBe("Hello {{NAME}}!");
  });

  it("returns the template as-is when no placeholders exist", () => {
    const result = fillTemplate("No placeholders here.", { X: "ignored" });
    expect(result).toBe("No placeholders here.");
  });

  it("handles empty values string gracefully", () => {
    const result = fillTemplate("Prefix{{PLACEHOLDER}}Suffix", { PLACEHOLDER: "" });
    expect(result).toBe("PrefixSuffix");
  });
});

describe("loadPromptTemplate()", () => {
  it("loads the research prompt file", () => {
    const content = loadPromptTemplate("research");
    expect(content).toContain("# Research Agent");
    expect(content).toContain("{{CONTEXT}}");
    expect(content).toContain("read, grep, and ls tools");
  });

  it("returns cached content on subsequent calls", () => {
    const first = loadPromptTemplate("research");
    const second = loadPromptTemplate("research");
    expect(first).toBe(second);
  });

  it("throws for a non-existent prompt file", () => {
    expect(() => loadPromptTemplate("non-existent-prompt")).toThrow();
  });

  it("throws a descriptive error for missing files", () => {
    expect(() => loadPromptTemplate("non-existent-prompt")).toThrow(/non-existent-prompt/);
  });
});
