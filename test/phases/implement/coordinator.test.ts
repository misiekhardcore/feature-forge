import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs so agents can load prompts
vi.mock("node:fs", () => ({
  readFileSync: vi.fn((path: string) => {
    if (path.endsWith("build.md")) return "BUILD: implement {{issueRef}} prev={{previousFindings}}";
    if (path.endsWith("review.md")) return "REVIEW: check {{worktreePath}}";
    if (path.endsWith("verify.md")) return "VERIFY: test {{worktreePath}}";
    if (path.endsWith("pr.md")) return "PR: open for {{branch}}";
    return "";
  }),
}));

import { ImplementCoordinator } from "../../../.pi/extensions/feature-forge/phases/implement/coordinator";

const mockRun = vi.fn();
const mockSpawner = { run: mockRun };

function makeHandoff(lines: string[]): string {
  return "## Handoff\n" + lines.map((l) => "- " + l).join("\n");
}

describe("ImplementCoordinator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeCoordinator(issueRef = "https://github.com/o/r/issues/1") {
    return new ImplementCoordinator(issueRef, mockSpawner as never);
  }

  it("runs build → review → verify cycle and opens PR on pass", async () => {
    mockRun
      .mockResolvedValueOnce({
        stdout: makeHandoff(["status: pass", "worktreePath: /wt", "branch: feat/x"]),
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: makeHandoff(["status: pass", "findings: |\n  All AC met"]),
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: makeHandoff(["status: pass", 'remaining_issues: ""']),
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: makeHandoff(["status: pass", "prUrl: https://github.com/o/r/pull/1"]),
        exitCode: 0,
      });

    const progress: string[] = [];
    const result = await makeCoordinator().run((msg) => progress.push(msg));

    expect(result.prUrl).toBe("https://github.com/o/r/pull/1");
    expect(progress).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Cycle 1/5: building"),
        expect.stringContaining("Cycle 1/5: reviewing"),
        expect.stringContaining("Cycle 1/5: verifying"),
        expect.stringContaining("Cycle 1/5: passed"),
        expect.stringContaining("Opening PR"),
        expect.stringContaining("PR opened"),
      ]),
    );
    expect(mockRun).toHaveBeenCalledTimes(4);
  });

  it("retries up to 5 cycles when verify fails, then aborts", async () => {
    // Need 5 cycles × 3 calls (build, review, verify) = 15 calls total.
    // Set all 15 to fail on verify, pass on build/review.
    const buildResult = {
      stdout: makeHandoff(["status: pass", "worktreePath: /wt", "branch: feat/x"]),
      exitCode: 0,
    };
    const reviewResult = {
      stdout: makeHandoff(["status: pass", "findings: minor"]),
      exitCode: 0,
    };
    const verifyFail = {
      stdout: makeHandoff(["status: fail", "remaining_issues: |\n  Still broken"]),
      exitCode: 0,
    };

    for (let cycle = 0; cycle < 5; cycle++) {
      mockRun.mockResolvedValueOnce(buildResult);
      mockRun.mockResolvedValueOnce(reviewResult);
      mockRun.mockResolvedValueOnce(verifyFail);
    }

    const progress: string[] = [];
    const result = await makeCoordinator().run((msg) => progress.push(msg));

    expect(result.prUrl).toBeUndefined();
    expect(progress).toEqual(
      expect.arrayContaining([expect.stringContaining("All 5 cycles exhausted")]),
    );
  });

  it("injects previous findings into subsequent build cycles", async () => {
    mockRun
      .mockResolvedValueOnce({
        stdout: makeHandoff(["status: pass", "worktreePath: /wt", "branch: feat/x"]),
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: makeHandoff(["status: pass", "findings: code style issues"]),
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: makeHandoff(["status: fail", "remaining_issues: |\n  AC2 failing"]),
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: makeHandoff(["status: pass", "worktreePath: /wt", "branch: feat/x"]),
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: makeHandoff(["status: pass", "findings: fixed"]),
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: makeHandoff(["status: pass", 'remaining_issues: ""']),
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: makeHandoff(["status: pass", "prUrl: https://github.com/o/r/pull/2"]),
        exitCode: 0,
      });

    const progress: string[] = [];
    const result = await makeCoordinator().run(() => progress.push("progress"));

    expect(result.prUrl).toBe("https://github.com/o/r/pull/2");

    // Second build call should include previous findings
    const secondBuildPrompt = mockRun.mock.calls[3][0] as string;
    expect(secondBuildPrompt).toContain("AC2 failing");
  });

  it("aborts when build produces no worktree or branch", async () => {
    // Build returns fail status with no worktree/branch.
    // Coordinator runs cycle 1 (build → review → verify with empty default),
    // breaks loop when verify passes, then aborts PR due to missing worktree.
    mockRun
      .mockResolvedValueOnce({
        stdout: makeHandoff(["status: fail", "error: could not create worktree"]),
        exitCode: 1,
      })
      .mockResolvedValue({ stdout: "", exitCode: 0 });

    const progress: string[] = [];
    const result = await makeCoordinator("https://github.com/o/r/issues/42").run((msg) =>
      progress.push(msg),
    );

    expect(result.prUrl).toBeUndefined();
    expect(progress).toEqual(
      expect.arrayContaining([expect.stringContaining("No worktree or branch")]),
    );
  });
});
