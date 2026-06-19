import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn((path: string) => {
    if (path.includes("prompts/main.md")) return "DISCOVERY_PROMPT_CONTENT";
    return "";
  }),
}));

import { DiscoverPhase } from "../../.pi/extensions/feature-forge/phases/discover";

describe("DiscoverPhase", () => {
  let mockPi: ExtensionAPI;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPi = {
      registerCommand: vi.fn(),
      sendUserMessage: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExtensionAPI;
  });

  it("has the correct name and description", () => {
    const phase = new DiscoverPhase(mockPi);
    expect(phase.name).toBe("discover");
    expect(phase.description).toMatch(/discovery/i);
  });

  it("notifies error when args are empty", async () => {
    const notify = vi.fn();
    const phase = new DiscoverPhase(mockPi);

    await phase.handler("", { ui: { notify } } as never);

    expect(notify).toHaveBeenCalledWith("Usage: /discover <feature idea>", "error");
  });

  it("notifies error when args are whitespace-only", async () => {
    const notify = vi.fn();
    const phase = new DiscoverPhase(mockPi);

    await phase.handler("   ", { ui: { notify } } as never);

    expect(notify).toHaveBeenCalledWith("Usage: /discover <feature idea>", "error");
  });

  it("sends discovery prompt with feature idea", async () => {
    const sendUserMessage = vi.fn().mockResolvedValue(undefined);
    mockPi.sendUserMessage = sendUserMessage;

    const phase = new DiscoverPhase(mockPi);

    await phase.handler("Add dark mode", { ui: { notify: vi.fn() } } as never);

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    const messages = sendUserMessage.mock.calls[0][0];
    expect(messages[0].text).toBe("DISCOVERY_PROMPT_CONTENT");
    expect(messages[1].text).toContain("Add dark mode");
  });
});
