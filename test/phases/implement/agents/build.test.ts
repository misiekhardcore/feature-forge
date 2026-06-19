import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRun = vi.fn();
vi.mock("../../../../.pi/extensions/feature-forge/pi-spawner", () => ({
  PiSpawner: class {
    run = mockRun;
  },
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn((path: string) => {
    if (path.endsWith("build.md")) return "BUILD_PROMPT";
    return "";
  }),
}));

import { BuildAgent } from "../../../../.pi/extensions/feature-forge/phases/implement/agents/build";

describe("BuildAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockResolvedValue({
      stdout: "## Handoff\n- status: pass\n- worktreePath: /wt\n- branch: feat/x\n",
      exitCode: 0,
    });
  });

  it("has the correct name and prompt file", () => {
    const agent = new BuildAgent("/fake", { run: mockRun } as never);
    expect(agent.name).toBe("build");
  });

  it("loads build.md prompt", async () => {
    const agent = new BuildAgent("/fake", { run: mockRun } as never);
    await agent.execute({ issueRef: "https://github.com/o/r/issues/1", cycleNumber: 1 });
    const [prompt] = mockRun.mock.calls[0] as [string];
    expect(prompt).toBe("BUILD_PROMPT");
  });

  it("extracts worktreePath and branch from handoff", async () => {
    const agent = new BuildAgent("/fake", { run: mockRun } as never);
    const result = await agent.execute({
      issueRef: "https://github.com/o/r/issues/1",
      cycleNumber: 1,
    });
    expect(result.worktreePath).toBe("/wt");
    expect(result.branch).toBe("feat/x");
  });
});
