import { describe, it, expect } from "vitest";
import {
  DISCOVERY_PROMPT,
  DEFINE_PROMPT,
  researchPrompt,
  IMPLEMENT_PROMPTS,
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

describe("IMPLEMENT_PROMPTS", () => {
  it("exports all 5 prompt keys", () => {
    expect(Object.keys(IMPLEMENT_PROMPTS)).toEqual([
      "coordinator",
      "build",
      "review",
      "verify",
      "pr",
    ]);
  });

  it("each prompt is a non-empty string", () => {
    for (const [key, value] of Object.entries(IMPLEMENT_PROMPTS)) {
      expect(typeof value).toBe("string");
      expect(value.length, `${key} prompt is empty`).toBeGreaterThan(0);
    }
  });

  it("coordinator prompt mentions sub-agents and cycles", () => {
    expect(IMPLEMENT_PROMPTS.coordinator).toMatch(/sub-agent|pi -p/i);
    expect(IMPLEMENT_PROMPTS.coordinator).toMatch(/cycle|loop/i);
  });

  it("build prompt mentions worktree creation", () => {
    expect(IMPLEMENT_PROMPTS.build).toMatch(/worktree|branch/i);
  });

  it("review prompt mentions acceptance criteria", () => {
    expect(IMPLEMENT_PROMPTS.review).toMatch(/acceptance criter|ac/i);
  });

  it("verify prompt mentions test suite", () => {
    expect(IMPLEMENT_PROMPTS.verify).toMatch(/npm test|npm run check/i);
  });

  it("pr prompt mentions gh pr create", () => {
    expect(IMPLEMENT_PROMPTS.pr).toMatch(/gh pr create|pull request/i);
  });

  it("each prompt has a Handoff section", () => {
    for (const [key, value] of Object.entries(IMPLEMENT_PROMPTS)) {
      expect(value, `${key} prompt missing Handoff section`).toMatch(/## Handoff/);
    }
  });

  it("sub-agent prompts have the no-interact rule", () => {
    for (const key of ["build", "review", "verify", "pr"] as const) {
      expect(IMPLEMENT_PROMPTS[key], `${key} prompt missing no-interact rule`).toMatch(
        /Do not interact with the user/i,
      );
    }
  });

  it("sub-agent prompts have the output-only rule", () => {
    for (const key of ["build", "review", "verify", "pr"] as const) {
      expect(IMPLEMENT_PROMPTS[key], `${key} prompt missing output-only rule`).toMatch(
        /Output ONLY the handoff section/i,
      );
    }
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
