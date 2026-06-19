import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

vi.mock("../../.pi/extensions/feature-forge/prompts", () => ({
  IMPLEMENT_PROMPTS: {
    coordinator: "IMPLEMENT_COORDINATOR_PROMPT",
    build: "BUILD_PROMPT",
    review: "REVIEW_PROMPT",
    verify: "VERIFY_PROMPT",
    pr: "PR_PROMPT",
  },
}));

import { registerImplement } from "../../.pi/extensions/feature-forge/commands/implement";

describe("registerImplement", () => {
  let mockPi: ExtensionAPI;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPi = {
      registerCommand: vi.fn(),
      sendUserMessage: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExtensionAPI;
  });

  it("registers the 'implement' command", () => {
    registerImplement(mockPi);
    expect(mockPi.registerCommand).toHaveBeenCalledWith(
      "implement",
      expect.objectContaining({
        description: expect.stringMatching(/build, review, verify/i),
      }),
    );
  });

  it("notifies error when no issue ref can be resolved", async () => {
    const notify = vi.fn();
    const handler = captureHandler();

    await handler(undefined, {
      ui: { notify },
      sessionManager: { getEntries: () => [] },
      cwd: "/cwd",
    });

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("No issue found"), "error");
  });

  it("notifies error when whitespace-only args and no session state", async () => {
    const notify = vi.fn();
    const handler = captureHandler();

    await handler("   ", {
      ui: { notify },
      sessionManager: { getEntries: () => [] },
      cwd: "/cwd",
    });

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("No issue found"), "error");
  });

  it("sends coordinator prompt with issue ref when resolved from args", async () => {
    const notify = vi.fn();
    const sendUserMessage = vi.fn().mockResolvedValue(undefined);
    mockPi.sendUserMessage = sendUserMessage;

    const handler = captureHandler();

    await handler("https://github.com/o/r/issues/42", {
      ui: { notify },
      sessionManager: { getEntries: () => [] },
      cwd: "/cwd",
    });

    expect(notify).toHaveBeenCalledWith("Starting implementation coordinator...", "info");
    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    const messages = sendUserMessage.mock.calls[0][0];
    expect(messages[0].text).toBe("IMPLEMENT_COORDINATOR_PROMPT");
    expect(messages[1].text).toContain("https://github.com/o/r/issues/42");
  });

  it("sends coordinator prompt with issue ref from pipeline state", async () => {
    const notify = vi.fn();
    const sendUserMessage = vi.fn().mockResolvedValue(undefined);
    mockPi.sendUserMessage = sendUserMessage;

    const handler = captureHandler();

    await handler(undefined, {
      ui: { notify },
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
      cwd: "/cwd",
    });

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    const messages = sendUserMessage.mock.calls[0][0];
    expect(messages[1].text).toContain("https://github.com/o/r/issues/7");
  });

  it("handles null sessionManager gracefully", async () => {
    const notify = vi.fn();
    const sendUserMessage = vi.fn().mockResolvedValue(undefined);
    mockPi.sendUserMessage = sendUserMessage;

    const handler = captureHandler();

    await handler("https://github.com/o/r/issues/42", {
      ui: { notify },
      sessionManager: null,
      cwd: "/cwd",
    });

    // Should not throw — null guard handles it
    expect(sendUserMessage).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Helper
  // -----------------------------------------------------------------------
  function captureHandler(): (
    args: string | undefined,
    ctx: Record<string, unknown>,
  ) => Promise<void> {
    registerImplement(mockPi);
    const call = (mockPi.registerCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    return call[1].handler as (
      args: string | undefined,
      ctx: Record<string, unknown>,
    ) => Promise<void>;
  }
});
