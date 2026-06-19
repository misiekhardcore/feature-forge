import { describe, it, expect } from "vitest";
import {
  DISCOVERY_PROMPT,
  DEFINE_PROMPT,
  researchPrompt,
} from "../.pi/extensions/feature-forge/prompts";

describe("prompt constants", () => {
  it("DISCOVERY_PROMPT is a non-empty string", () => {
    expect(typeof DISCOVERY_PROMPT).toBe("string");
    expect(DISCOVERY_PROMPT.length).toBeGreaterThan(0);
  });

  it("DISCOVERY_PROMPT contains discovery-related content", () => {
    expect(DISCOVERY_PROMPT).toMatch(/discover|interview|issue/i);
  });

  it("DEFINE_PROMPT is a non-empty string", () => {
    expect(typeof DEFINE_PROMPT).toBe("string");
    expect(DEFINE_PROMPT.length).toBeGreaterThan(0);
  });

  it("DEFINE_PROMPT contains implementation plan guidance", () => {
    expect(DEFINE_PROMPT).toMatch(/implementation plan|definition phase/i);
  });

  it("DEFINE_PROMPT step 5 says 'Post' not 'Commit'", () => {
    // Regression test for review finding: "Commit" header was misleading.
    expect(DEFINE_PROMPT).toMatch(/### 5\.\s*Post/);
  });

  it("DEFINE_PROMPT tells LLM not to git commit", () => {
    expect(DEFINE_PROMPT).toMatch(/Do NOT git commit/);
  });
});

describe("researchPrompt", () => {
  it("returns a string with the issueUrl interpolated", () => {
    const result = researchPrompt("https://github.com/o/r/issues/42");
    expect(result).toContain("https://github.com/o/r/issues/42");
  });

  it("does not contain raw placeholder after interpolation", () => {
    const result = researchPrompt("https://example.com/1");
    expect(result).not.toContain("{{issueUrl}}");
  });

  it("handles URLs with special regex characters safely", () => {
    // URL with characters that could interfere with naive regex replacement.
    const result = researchPrompt("https://github.com/o/r/issues/1?q=foo+bar");
    expect(result).toContain("https://github.com/o/r/issues/1?q=foo+bar");
    expect(result).not.toContain("{{");
  });
});
