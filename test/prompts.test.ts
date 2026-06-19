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

// ---------------------------------------------------------------------------
// Phase base class
// ---------------------------------------------------------------------------
describe("Phase base class", () => {
  class TestPhase extends Phase {
    readonly name = "test";
    readonly description = "A test phase";
    constructor(dir: string) {
      super(dir);
    }
    async handler() {
      // no-op
    }
  }

  it("loadPrompt reads from prompts/ subdirectory", () => {
    const phase = new TestPhase("/fake/path");

    const prompt = (phase as unknown as { loadPrompt(n: string): string }).loadPrompt("main");
    expect(prompt).toBe("MAIN_PROMPT");
  });

  it("loadAgent reads from agents/ subdirectory", () => {
    const phase = new TestPhase("/fake/path");

    const prompt = (phase as unknown as { loadAgent(n: string): string }).loadAgent("research");
    expect(prompt).toBe("AGENT_PROMPT");
  });

  it("readFileSync is called with correct paths", () => {
    readFileSync.mockClear();

    const phase = new TestPhase("/base/dir");

    (phase as unknown as { loadPrompt(n: string): string }).loadPrompt("test");

    (phase as unknown as { loadAgent(n: string): string }).loadAgent("test");

    expect(readFileSync).toHaveBeenCalledWith("/base/dir/prompts/test.md", "utf-8");
    expect(readFileSync).toHaveBeenCalledWith("/base/dir/agents/test.md", "utf-8");
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
      registerCommand: vi.fn(),
      sendUserMessage: vi.fn(),
    } as unknown as ExtensionAPI;
  });

  it("registers a command for each phase", () => {
    class PhaseA extends Phase {
      readonly name = "alpha";
      readonly description = "Alpha phase";
      constructor() {
        super("/fake");
      }
      async handler() {}
    }
    class PhaseB extends Phase {
      readonly name = "beta";
      readonly description = "Beta phase";
      constructor() {
        super("/fake");
      }
      async handler() {}
    }

    registerPhases(mockPi, [new PhaseA(), new PhaseB()]);

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

  it("sets pi property on each phase before registering", () => {
    class TestPhase extends Phase {
      readonly name = "test";
      readonly description = "Test";
      constructor() {
        super("/fake");
      }
      async handler() {
        // no-op
      }
      getPi() {
        return this.pi;
      }
    }

    const phase = new TestPhase();
    registerPhases(mockPi, [phase]);

    expect(phase.getPi()).toBe(mockPi);
  });
});
