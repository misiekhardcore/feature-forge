import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Mock prompts since it reads files at import time
vi.mock("../../.pi/extensions/feature-forge/prompts", () => ({
  DISCOVERY_PROMPT: "DISCOVERY_PROMPT_CONTENT",
}));

import { registerDiscover } from "../../.pi/extensions/feature-forge/commands/discover";

describe("registerDiscover", () => {
  let mockPi: ExtensionAPI;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPi = {
      registerCommand: vi.fn(),
      sendUserMessage: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExtensionAPI;
  });

  it("registers the 'discover' command", () => {
    registerDiscover(mockPi);
    expect(mockPi.registerCommand).toHaveBeenCalledWith(
      "discover",
      expect.objectContaining({
        description: expect.stringContaining("discovery"),
      }),
    );
  });

  it("notifies error when args are empty", async () => {
    const notify = vi.fn();
    const handler = captureHandler();

    await handler("", {
      ui: { notify },
    });

    expect(notify).toHaveBeenCalledWith("Usage: /discover <feature idea>", "error");
  });

  it("notifies error when args are whitespace-only", async () => {
    const notify = vi.fn();
    const handler = captureHandler();

    await handler("   ", {
      ui: { notify },
    });

    expect(notify).toHaveBeenCalledWith("Usage: /discover <feature idea>", "error");
  });

  it("sends discovery prompt with feature idea", async () => {
    const sendUserMessage = vi.fn().mockResolvedValue(undefined);
    mockPi.sendUserMessage = sendUserMessage;

    const handler = captureHandler();

    await handler("Add dark mode", {
      ui: { notify: vi.fn() },
    });

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    const messages = sendUserMessage.mock.calls[0][0];
    expect(messages[0].text).toBe("DISCOVERY_PROMPT_CONTENT");
    expect(messages[1].text).toContain("Add dark mode");
  });

  // -----------------------------------------------------------------------
  // Helper
  // -----------------------------------------------------------------------
  function captureHandler(): (args: string, ctx: Record<string, unknown>) => Promise<void> {
    registerDiscover(mockPi);
    const call = (mockPi.registerCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    return call[1].handler as (args: string, ctx: Record<string, unknown>) => Promise<void>;
  }
});
