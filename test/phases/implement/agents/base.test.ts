import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn((path: string) => {
    if (path.endsWith("test-agent.md"))
      return "Test prompt for {{issueRef}} cycle {{cycleN}} wt={{worktreePath}} br={{branch}} prev={{previousFindings}} rev={{reviewFindings}}";
    return "";
  }),
}));

import { SubAgent } from "../../../../.pi/extensions/feature-forge/phases/implement/agents/base";

class TestAgent extends SubAgent {
  readonly name = "test";
  protected readonly promptFile = "test-agent.md";
}

describe("SubAgent", () => {
  const mockRun = vi.fn();

  function makeAgent(): TestAgent {
    return new TestAgent("/fake", { run: mockRun } as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("buildPrompt", () => {
    it("replaces template variables in the prompt", async () => {
      mockRun.mockResolvedValue({ stdout: "## Handoff\n- status: pass\n", exitCode: 0 });
      const agent = makeAgent();

      await agent.execute({
        issueRef: "https://github.com/o/r/issues/1",
        cycleNumber: 2,
      });

      const [prompt] = mockRun.mock.calls[0] as [string];
      expect(prompt).toContain("https://github.com/o/r/issues/1");
      expect(prompt).toContain("cycle 2");
    });

    it("replaces optional fields when present", async () => {
      mockRun.mockResolvedValue({ stdout: "## Handoff\n- status: pass\n", exitCode: 0 });
      const agent = makeAgent();

      await agent.execute({
        issueRef: "https://github.com/o/r/issues/1",
        cycleNumber: 1,
        worktreePath: "/wt/path",
        branch: "feat/test",
        previousFindings: "AC2 failed",
        reviewFindings: "Code quality issues",
      });

      const [prompt] = mockRun.mock.calls[0] as [string];
      expect(prompt).toContain("/wt/path");
      expect(prompt).toContain("feat/test");
      expect(prompt).toContain("AC2 failed");
      expect(prompt).toContain("Code quality issues");
    });
  });

  describe("parseResult - ## Handoff section", () => {
    it("parses simple handoff fields", async () => {
      mockRun.mockResolvedValue({
        stdout:
          "## Handoff\n- status: pass\n- worktreePath: /wt\n- branch: feat/x\n- prUrl: https://github.com/o/r/pull/1\n",
        exitCode: 0,
      });
      const agent = makeAgent();

      const result = await agent.execute({
        issueRef: "https://github.com/o/r/issues/1",
        cycleNumber: 1,
      });

      expect(result.status).toBe("pass");
      expect(result.worktreePath).toBe("/wt");
      expect(result.branch).toBe("feat/x");
      expect(result.prUrl).toBe("https://github.com/o/r/pull/1");
    });

    it("parses multi-line fields (summary, findings, remaining_issues)", async () => {
      mockRun.mockResolvedValue({
        stdout: [
          "## Handoff",
          "- status: fail",
          "- findings: |",
          "  AC2: missing error handling",
          "  AC3: edge case not covered",
          "- status: pass",
        ].join("\n"),
        exitCode: 0,
      });
      const agent = makeAgent();

      const result = await agent.execute({
        issueRef: "https://github.com/o/r/issues/1",
        cycleNumber: 1,
      });

      expect(result.status).toBe("pass");
      expect(result.findings).toContain("AC2: missing error handling");
      expect(result.findings).toContain("AC3: edge case not covered");
    });

    it("uses exit code as fallback when no Handoff section exists", async () => {
      mockRun.mockResolvedValue({
        stdout: "Some raw output without handoff",
        exitCode: 1,
      });
      const agent = makeAgent();

      const result = await agent.execute({
        issueRef: "https://github.com/o/r/issues/1",
        cycleNumber: 1,
      });

      expect(result.status).toBe("fail");
      expect(result.output).toBe("Some raw output without handoff");
    });

    it("uses handoff status over exit code", async () => {
      mockRun.mockResolvedValue({
        stdout: "## Handoff\n- status: pass\n",
        exitCode: 1,
      });
      const agent = makeAgent();

      const result = await agent.execute({
        issueRef: "https://github.com/o/r/issues/1",
        cycleNumber: 1,
      });

      expect(result.status).toBe("pass");
    });
  });
});
