import { describe, expect, it } from "vitest";

import { AgentSpecification } from "../specifications/AgentSpecification";
import { buildPiCliArguments } from "./helpers";

describe("buildPiCliArguments", () => {
  it("produces no CLI arguments for a minimal specification", () => {
    const spec = new (class extends AgentSpecification {
      constructor() {
        super({
          id: "minimal",
          role: "minimal",
          systemPrompt: "test",
        });
      }
    })();
    expect(buildPiCliArguments(spec)).toEqual([]);
  });

  describe("builtin tools flag", () => {
    it("adds --no-builtin-tools when disableBuiltinTools is true", () => {
      const spec = new (class extends AgentSpecification {
        constructor() {
          super({
            id: "t",
            role: "t",
            systemPrompt: "p",
            disableBuiltinTools: true,
          });
        }
      })();
      expect(buildPiCliArguments(spec)).toContain("--no-builtin-tools");
    });

    it("does not add --no-builtin-tools when disableBuiltinTools is false", () => {
      const spec = new (class extends AgentSpecification {
        constructor() {
          super({
            id: "t",
            role: "t",
            systemPrompt: "p",
          });
        }
      })();
      expect(buildPiCliArguments(spec)).not.toContain("--no-builtin-tools");
    });
  });

  describe("resource loading flags", () => {
    it("adds --no-extensions when disableExtensions is true", () => {
      const spec = new (class extends AgentSpecification {
        constructor() {
          super({
            id: "t",
            role: "t",
            systemPrompt: "p",
            disableExtensions: true,
          });
        }
      })();
      expect(buildPiCliArguments(spec)).toContain("--no-extensions");
    });

    it("adds --no-skills when disableSkills is true", () => {
      const spec = new (class extends AgentSpecification {
        constructor() {
          super({
            id: "t",
            role: "t",
            systemPrompt: "p",
            disableSkills: true,
          });
        }
      })();
      expect(buildPiCliArguments(spec)).toContain("--no-skills");
    });

    it("adds --no-prompt-templates when disablePromptTemplates is true", () => {
      const spec = new (class extends AgentSpecification {
        constructor() {
          super({
            id: "t",
            role: "t",
            systemPrompt: "p",
            disablePromptTemplates: true,
          });
        }
      })();
      expect(buildPiCliArguments(spec)).toContain("--no-prompt-templates");
    });

    it("adds --no-context-files when disableContextFiles is true", () => {
      const spec = new (class extends AgentSpecification {
        constructor() {
          super({
            id: "t",
            role: "t",
            systemPrompt: "p",
            disableContextFiles: true,
          });
        }
      })();
      expect(buildPiCliArguments(spec)).toContain("--no-context-files");
    });
  });

  describe("skill CLI arguments", () => {
    it("emits --no-skills when skills is non-empty even if no skills are discovered", () => {
      const spec = new (class extends AgentSpecification {
        constructor() {
          super({
            id: "t",
            role: "t",
            systemPrompt: "p",
            skills: ["nonexistent-skill"],
          });
        }
      })();
      const args = buildPiCliArguments(spec);
      expect(args).toContain("--no-skills");
    });

    it("emits --no-skills when excludedSkills is non-empty", () => {
      const spec = new (class extends AgentSpecification {
        constructor() {
          super({
            id: "t",
            role: "t",
            systemPrompt: "p",
            excludedSkills: ["some-skill"],
          });
        }
      })();
      const args = buildPiCliArguments(spec);
      expect(args).toContain("--no-skills");
    });

    it("does not emit selective skill flags when both skills and excludedSkills are empty", () => {
      const spec = new (class extends AgentSpecification {
        constructor() {
          super({
            id: "t",
            role: "t",
            systemPrompt: "p",
          });
        }
      })();
      const args = buildPiCliArguments(spec);
      expect(args).not.toContain("--no-skills");
    });

    it("disableSkills still emits --no-skills regardless of skills/excludedSkills", () => {
      const spec = new (class extends AgentSpecification {
        constructor() {
          super({
            id: "t",
            role: "t",
            systemPrompt: "p",
            skills: ["build-skill"],
            disableSkills: true,
          });
        }
      })();
      const args = buildPiCliArguments(spec);
      // disableSkills takes precedence — only one --no-skills
      const noSkillsCount = args.filter((a) => a === "--no-skills").length;
      expect(noSkillsCount).toBe(1);
    });
  });
  describe("session flag", () => {
    it("adds --no-session when ephemeral is true", () => {
      const spec = new (class extends AgentSpecification {
        constructor() {
          super({
            id: "t",
            role: "t",
            systemPrompt: "p",
            ephemeral: true,
          });
        }
      })();
      expect(buildPiCliArguments(spec)).toContain("--no-session");
    });

    it("does not add --no-session when ephemeral is false", () => {
      const spec = new (class extends AgentSpecification {
        constructor() {
          super({
            id: "t",
            role: "t",
            systemPrompt: "p",
          });
        }
      })();
      expect(buildPiCliArguments(spec)).not.toContain("--no-session");
    });
  });
});
