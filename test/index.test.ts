import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

vi.mock("../.pi/extensions/feature-forge/phases/registry", () => ({
  registerPhases: vi.fn(),
}));

vi.mock("../.pi/extensions/feature-forge/state", () => {
  const State = { initialize: vi.fn(), getInstance: vi.fn() };
  return { State };
});

import featureForge from "../.pi/extensions/feature-forge/index";

describe("feature-forge extension", () => {
  let mockPi: ExtensionAPI;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPi = {
      on: vi.fn(),
      registerCommand: vi.fn(),
      sendUserMessage: vi.fn(),
      appendEntry: vi.fn(),
    } as unknown as ExtensionAPI;
  });

  it("creates a State instance", async () => {
    const { State } = await import("../.pi/extensions/feature-forge/state");

    featureForge(mockPi);

    expect(State.initialize).toHaveBeenCalledWith(mockPi);
  });

  it("registers all three phase classes via registerPhases", async () => {
    const { registerPhases } = await import("../.pi/extensions/feature-forge/phases/registry");

    featureForge(mockPi);

    expect(registerPhases).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
    );
    const classes = (registerPhases as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(classes).toHaveLength(3);
    expect(classes[0].name).toMatch(/Discover/i);
    expect(classes[1].name).toMatch(/Define/i);
    expect(classes[2].name).toMatch(/Implement/i);
  });
});
