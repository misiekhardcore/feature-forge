import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRun = vi.fn();
vi.mock("../../../../.pi/extensions/feature-forge/pi-spawner", () => ({
  PiSpawner: class {
    run = mockRun;
  },
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn((path: string) => {
    if (path.endsWith("pr.md")) return "PR_PROMPT";
    return "";
  }),
}));

import { PrAgent } from "../../../../.pi/extensions/feature-forge/phases/implement/agents/pr";

describe("PrAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockResolvedValue({
      stdout: "## Handoff\n- status: pass\n- prUrl: https://github.com/o/r/pull/99\n",
      exitCode: 0,
    });
  });

  it("has the correct name", () => {
    const agent = new PrAgent("/fake", { run: mockRun } as never);
    expect(agent.name).toBe("pr");
  });

  it("loads pr.md prompt", async () => {
    const agent = new PrAgent("/fake", { run: mockRun } as never);
    await agent.execute({ issueRef: "https://github.com/o/r/issues/1", cycleNumber: 1 });
    const [prompt] = mockRun.mock.calls[0] as [string];
    expect(prompt).toBe("PR_PROMPT");
  });

  it("extracts prUrl from handoff", async () => {
    const agent = new PrAgent("/fake", { run: mockRun } as never);
    const result = await agent.execute({
      issueRef: "https://github.com/o/r/issues/1",
      cycleNumber: 1,
    });
    expect(result.prUrl).toBe("https://github.com/o/r/pull/99");
  });
});
