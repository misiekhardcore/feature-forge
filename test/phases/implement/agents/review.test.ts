import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRun = vi.fn();
vi.mock("../../../../.pi/extensions/feature-forge/pi-spawner", () => ({
  PiSpawner: class {
    run = mockRun;
  },
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn((path: string) => {
    if (path.endsWith("review.md")) return "REVIEW_PROMPT";
    return "";
  }),
}));

import { ReviewAgent } from "../../../../.pi/extensions/feature-forge/phases/implement/agents/review";

describe("ReviewAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockResolvedValue({
      stdout: "## Handoff\n- status: pass\n- findings: |\n  All AC met\n",
      exitCode: 0,
    });
  });

  it("has the correct name", () => {
    const agent = new ReviewAgent("/fake", { run: mockRun } as never);
    expect(agent.name).toBe("review");
  });

  it("loads review.md prompt", async () => {
    const agent = new ReviewAgent("/fake", { run: mockRun } as never);
    await agent.execute({ issueRef: "https://github.com/o/r/issues/1", cycleNumber: 1 });
    const [prompt] = mockRun.mock.calls[0] as [string];
    expect(prompt).toBe("REVIEW_PROMPT");
  });

  it("extracts findings from handoff", async () => {
    const agent = new ReviewAgent("/fake", { run: mockRun } as never);
    const result = await agent.execute({
      issueRef: "https://github.com/o/r/issues/1",
      cycleNumber: 1,
    });
    expect(result.findings).toContain("All AC met");
  });
});
