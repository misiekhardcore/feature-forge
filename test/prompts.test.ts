import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn((path: string) => {
    if (path.includes("prompts/main.md")) return "MAIN_PROMPT";
    if (path.includes("agents/research.md")) return "AGENT_PROMPT";
    return "";
  }),
}));

import * as fs from "node:fs";
const readFileSync = (fs as unknown as { readFileSync: ReturnType<typeof vi.fn> }).readFileSync;

import { Phase } from "../.pi/extensions/feature-forge/phases/base";
import { registerPhases } from "../.pi/extensions/feature-forge/phases/registry";
import { State } from "../.pi/extensions/feature-forge/state";

// ---------------------------------------------------------------------------
// Phase base class
// ---------------------------------------------------------------------------
describe("Phase base class", () => {
  class TestPhase extends Phase {
    readonly name = "test";
    readonly description = "A test phase";
    constructor(pi: ExtensionAPI) {
      super(pi, "/fake/path");
    }
    async handler() {
      // no-op
    }
  }

  it("loadPrompt reads from prompts/ subdirectory", () => {
    const phase = new TestPhase({} as ExtensionAPI);

    const prompt = (phase as unknown as { loadPrompt(n: string): string }).loadPrompt("main");
    expect(prompt).toBe("MAIN_PROMPT");
  });

  it("loadAgent reads from agents/ subdirectory", () => {
    const phase = new TestPhase({} as ExtensionAPI);

    const prompt = (phase as unknown as { loadAgent(n: string): string }).loadAgent("research");
    expect(prompt).toBe("AGENT_PROMPT");
  });

  it("readFileSync is called with correct paths", () => {
    readFileSync.mockClear();

    const phase = new TestPhase({} as ExtensionAPI);

    (phase as unknown as { loadPrompt(n: string): string }).loadPrompt("test");

    (phase as unknown as { loadAgent(n: string): string }).loadAgent("test");

    expect(readFileSync).toHaveBeenCalledWith("/fake/path/prompts/test.md", "utf-8");
    expect(readFileSync).toHaveBeenCalledWith("/fake/path/agents/test.md", "utf-8");
  });
});

// ---------------------------------------------------------------------------
// registerPhases
// ---------------------------------------------------------------------------
describe("registerPhases", () => {
  let mockPi: ExtensionAPI;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPi = {
      on: vi.fn(),
      registerCommand: vi.fn(),
      sendUserMessage: vi.fn(),
      appendEntry: vi.fn(),
    } as unknown as ExtensionAPI;
    State.reset();
    State.initialize(mockPi);
  });

  it("registers a command for each phase class", () => {
    class PhaseA extends Phase {
      readonly name = "alpha";
      readonly description = "Alpha phase";
      constructor(pi: ExtensionAPI) {
        super(pi, "/fake");
      }
      async handler() {}
    }
    class PhaseB extends Phase {
      readonly name = "beta";
      readonly description = "Beta phase";
      constructor(pi: ExtensionAPI) {
        super(pi, "/fake");
      }
      async handler() {}
    }

    registerPhases(PhaseA, PhaseB);

    expect(mockPi.registerCommand).toHaveBeenCalledTimes(2);
    expect(mockPi.registerCommand).toHaveBeenCalledWith(
      "alpha",
      expect.objectContaining({ description: "Alpha phase" }),
    );
    expect(mockPi.registerCommand).toHaveBeenCalledWith(
      "beta",
      expect.objectContaining({ description: "Beta phase" }),
    );
  });

  it("creates instances internally with pi passed to constructor", () => {
    let capturedPi: ExtensionAPI | undefined;

    class TestPhase extends Phase {
      readonly name = "test";
      readonly description = "Test";
      constructor(pi: ExtensionAPI) {
        super(pi, "/fake");
        capturedPi = pi;
      }
      async handler() {}
    }

    registerPhases(TestPhase);

    expect(capturedPi).toBe(mockPi);
  });
});
