import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRun = vi.fn();
vi.mock("../../../../.pi/extensions/feature-forge/pi-spawner", () => ({
  PiSpawner: class {
    run = mockRun;
  },
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn((path: string) => {
    if (path.endsWith("verify.md")) return "VERIFY_PROMPT";
    return "";
  }),
}));

import { VerifyAgent } from "../../../../.pi/extensions/feature-forge/phases/implement/agents/verify";

describe("VerifyAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRun.mockResolvedValue({
      stdout: '## Handoff\n- status: pass\n- remaining_issues: ""\n',
      exitCode: 0,
    });
  });

  it("has the correct name", () => {
    const agent = new VerifyAgent("/fake", { run: mockRun } as never);
    expect(agent.name).toBe("verify");
  });

  it("loads verify.md prompt", async () => {
    const agent = new VerifyAgent("/fake", { run: mockRun } as never);
    await agent.execute({ issueRef: "https://github.com/o/r/issues/1", cycleNumber: 1 });
    const [prompt] = mockRun.mock.calls[0] as [string];
    expect(prompt).toBe("VERIFY_PROMPT");
  });

  it("extracts remaining_issues from handoff", async () => {
    const agent = new VerifyAgent("/fake", { run: mockRun } as never);
    const result = await agent.execute({
      issueRef: "https://github.com/o/r/issues/1",
      cycleNumber: 1,
    });
    expect(result.remainingIssues).toBe('""');
  });
});
