import { describe, expect, it } from "vitest";

import { AgentSpecification } from "../specifications/AgentSpecification";
import { ResearchAgentSpecification } from "../specifications/ResearchAgentSpecification";
import { buildPiCliArguments } from "./helpers";

describe("buildPiCliArguments", () => {
  it("returns empty array for minimal specification", () => {
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

  describe("tools flags", () => {
    it("adds --tools when toolNames is non-empty", () => {
      const spec = new (class extends AgentSpecification {
        constructor() {
          super({
            id: "t",
            role: "t",
            systemPrompt: "p",
            toolNames: ["read", "grep"],
          });
        }
      })();
      expect(buildPiCliArguments(spec)).toContain("--tools");
      const idx = buildPiCliArguments(spec).indexOf("--tools");
      expect(buildPiCliArguments(spec)[idx + 1]).toBe("read,grep");
    });

    it("does not add --tools when toolNames is empty", () => {
      const spec = new (class extends AgentSpecification {
        constructor() {
          super({
            id: "t",
            role: "t",
            systemPrompt: "p",
            toolNames: [],
          });
        }
      })();
      expect(buildPiCliArguments(spec)).not.toContain("--tools");
    });

    it("adds --exclude-tools when excludeToolNames is non-empty", () => {
      const spec = new (class extends AgentSpecification {
        constructor() {
          super({
            id: "t",
            role: "t",
            systemPrompt: "p",
            excludeToolNames: ["bash", "write"],
          });
        }
      })();
      expect(buildPiCliArguments(spec)).toContain("--exclude-tools");
      const idx = buildPiCliArguments(spec).indexOf("--exclude-tools");
      expect(buildPiCliArguments(spec)[idx + 1]).toBe("bash,write");
    });

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
  });

  describe("thinking flag", () => {
    it("adds --thinking when thinkingLevel is set", () => {
      const spec = new (class extends AgentSpecification {
        constructor() {
          super({
            id: "t",
            role: "t",
            systemPrompt: "p",
            thinkingLevel: "high",
          });
        }
      })();
      expect(buildPiCliArguments(spec)).toContain("--thinking");
      const idx = buildPiCliArguments(spec).indexOf("--thinking");
      expect(buildPiCliArguments(spec)[idx + 1]).toBe("high");
    });

    it("does not add --thinking when thinkingLevel is undefined", () => {
      const spec = new (class extends AgentSpecification {
        constructor() {
          super({
            id: "t",
            role: "t",
            systemPrompt: "p",
          });
        }
      })();
      expect(buildPiCliArguments(spec)).not.toContain("--thinking");
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
  });

  describe("ResearchAgentSpecification compatibility", () => {
    it("produces correct args for ResearchAgentSpecification", () => {
      const spec = new ResearchAgentSpecification();
      const args = buildPiCliArguments(spec);
      expect(args).toContain("--tools");
      const idx = args.indexOf("--tools");
      expect(args[idx + 1]).toBe("read,grep,ls");
      expect(args).toContain("--no-session");
    });
  });
});
