import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn((path: string) => {
    if (path.includes("prompts/coordinator.md")) return "IMPLEMENT_COORDINATOR_PROMPT";
    if (path.includes("agents/build.md")) return "BUILD_PROMPT";
    if (path.includes("agents/review.md")) return "REVIEW_PROMPT";
    if (path.includes("agents/verify.md")) return "VERIFY_PROMPT";
    if (path.includes("agents/pr.md")) return "PR_PROMPT";
    return "";
  }),
}));

import { ImplementPhase } from "../../.pi/extensions/feature-forge/phases/implement";
import { State } from "../../.pi/extensions/feature-forge/state";

describe("ImplementPhase", () => {
  let mockPi: ExtensionAPI;

  beforeEach(() => {
    State.reset();
    vi.clearAllMocks();
    mockPi = {
      registerCommand: vi.fn(),
      sendUserMessage: vi.fn().mockResolvedValue(undefined),
      appendEntry: vi.fn(),
      on: vi.fn(),
    } as unknown as ExtensionAPI;
    State.initialize(mockPi);
  });

  it("has the correct name and description", () => {
    const phase = new ImplementPhase(mockPi);
    expect(phase.name).toBe("implement");
    expect(phase.description).toMatch(/build, review, verify/i);
  });

  it("notifies error when no issue ref can be resolved", async () => {
    const notify = vi.fn();
    const phase = new ImplementPhase(mockPi);

    await phase.handler(undefined, {
      ui: { notify },
      sessionManager: { getEntries: () => [] },
    } as never);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("No issue found"), "error");
  });

  it("notifies error when whitespace-only args and no session state", async () => {
    const notify = vi.fn();
    const phase = new ImplementPhase(mockPi);

    await phase.handler("   ", {
      ui: { notify },
      sessionManager: { getEntries: () => [] },
    } as never);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("No issue found"), "error");
  });

  it("sends coordinator prompt with issue ref when resolved from args", async () => {
    const notify = vi.fn();
    const sendUserMessage = vi.fn().mockResolvedValue(undefined);
    mockPi.sendUserMessage = sendUserMessage;

    const phase = new ImplementPhase(mockPi);

    await phase.handler("https://github.com/o/r/issues/42", {
      ui: { notify },
      sessionManager: { getEntries: () => [] },
    } as never);

    expect(notify).toHaveBeenCalledWith("Starting implementation coordinator...", "info");
    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    const messages = sendUserMessage.mock.calls[0][0];
    expect(messages[0].text).toBe("IMPLEMENT_COORDINATOR_PROMPT");
    expect(messages[1].text).toContain("https://github.com/o/r/issues/42");
  });

  it("sends coordinator prompt with issue ref from pipeline state", async () => {
    const sendUserMessage = vi.fn().mockResolvedValue(undefined);
    mockPi.sendUserMessage = sendUserMessage;

    const phase = new ImplementPhase(mockPi);

    await phase.handler(undefined, {
      ui: { notify: vi.fn() },
      sessionManager: {
        getEntries: () => [
          {
            type: "custom",
            customType: "pipeline-issue",
            data: { issueUrl: "https://github.com/o/r/issues/7" },
            id: "e1",
            parentId: null,
            timestamp: new Date().toISOString(),
          },
        ],
      },
    } as never);

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    const messages = sendUserMessage.mock.calls[0][0];
    expect(messages[1].text).toContain("https://github.com/o/r/issues/7");
  });

  it("handles null sessionManager gracefully", async () => {
    const sendUserMessage = vi.fn().mockResolvedValue(undefined);
    mockPi.sendUserMessage = sendUserMessage;

    const phase = new ImplementPhase(mockPi);

    await phase.handler("https://github.com/o/r/issues/42", {
      ui: { notify: vi.fn() },
      sessionManager: null,
    } as never);

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
  });

  it("loads all agent prompts", () => {
    const phase = new ImplementPhase(mockPi);

    const loadAgent = (name: string) =>
      (ImplementPhase.prototype as unknown as { loadAgent(n: string): string }).loadAgent.call(
        phase,
        name,
      );

    expect(loadAgent("build")).toBe("BUILD_PROMPT");
    expect(loadAgent("review")).toBe("REVIEW_PROMPT");
    expect(loadAgent("verify")).toBe("VERIFY_PROMPT");
    expect(loadAgent("pr")).toBe("PR_PROMPT");
  });
});
