import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Mock PiSpawner so research doesn't actually spawn processes
const mockRun = vi.fn();
vi.mock("../../.pi/extensions/feature-forge/pi-spawner", () => ({
  PiSpawner: class {
    run = mockRun;
  },
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn((path: string) => {
    if (path.includes("agents/research.md")) {
      return "Research prompt for: {{issueUrl}}";
    }
    if (path.includes("prompts/main.md")) {
      return "DEFINE_PROMPT_CONTENT";
    }
    return "";
  }),
}));

import { DefinePhase } from "../../.pi/extensions/feature-forge/phases/define";
import { State } from "../../.pi/extensions/feature-forge/state";

// ---------------------------------------------------------------------------
// DefinePhase (research)
// ---------------------------------------------------------------------------
describe("DefinePhase - research", () => {
  let dummyPi: ExtensionAPI;

  beforeEach(() => {
    vi.clearAllMocks();
    dummyPi = {} as ExtensionAPI;
    mockRun.mockResolvedValue({ stdout: "## Research results\n\nFound some things.", exitCode: 0 });
  });

  it("runs research via PiSpawner with the correct prompt", async () => {
    const phase = new DefinePhase(dummyPi);
    const result = await (
      phase as unknown as { runBackgroundResearch(issueRef: string, cwd: string): Promise<string> }
    ).runBackgroundResearch("https://github.com/o/r/issues/1", "/fake/cwd");

    expect(mockRun).toHaveBeenCalledTimes(1);
    const [prompt, options] = mockRun.mock.calls[0] as [string, { cwd: string; timeout: number }];
    expect(prompt).toContain("Research prompt for:");
    expect(options.cwd).toBe("/fake/cwd");
    expect(options.timeout).toBe(180_000);
    expect(result).toBe("## Research results\n\nFound some things.");
  });

  it("replaces {{issueUrl}} in the prompt", async () => {
    const phase = new DefinePhase(dummyPi);
    await (
      phase as unknown as { runBackgroundResearch(issueRef: string, cwd: string): Promise<string> }
    ).runBackgroundResearch("https://github.com/o/r/issues/42", "/cwd");

    const [prompt] = mockRun.mock.calls[0] as [string];
    expect(prompt).toContain("https://github.com/o/r/issues/42");
    expect(prompt).not.toContain("{{issueUrl}}");
  });
});

// ---------------------------------------------------------------------------
// DefinePhase (handler)
// ---------------------------------------------------------------------------
describe("DefinePhase - handler", () => {
  let mockPi: ExtensionAPI;

  beforeEach(() => {
    State.reset();
    vi.clearAllMocks();
    mockRun.mockResolvedValue({ stdout: "research output", exitCode: 0 });

    mockPi = {
      registerCommand: vi.fn(),
      sendUserMessage: vi.fn().mockResolvedValue(undefined),
      appendEntry: vi.fn(),
      on: vi.fn(),
    } as unknown as ExtensionAPI;
    State.initialize(mockPi);
  });

  it("has the correct name", () => {
    const phase = new DefinePhase(mockPi);
    expect(phase.name).toBe("define");
    expect(phase.description).toMatch(/implementation plan/i);
  });

  it("notifies error when no issue ref can be resolved", async () => {
    const notify = vi.fn();
    const phase = new DefinePhase(mockPi);

    await phase.handler(undefined, {
      ui: { notify },
      sessionManager: { getEntries: () => [] },
      cwd: "/cwd",
    } as never);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("No issue found"), "error");
  });

  it("runs research and sends user message when issue ref is resolved", async () => {
    const notify = vi.fn();
    const sendUserMessage = vi.fn().mockResolvedValue(undefined);
    mockPi.sendUserMessage = sendUserMessage;

    const phase = new DefinePhase(mockPi);

    await phase.handler("https://github.com/o/r/issues/5", {
      ui: { notify },
      sessionManager: { getEntries: () => [] },
      cwd: "/project",
    } as never);

    expect(notify).toHaveBeenCalledWith(
      "Running background research in separate context...",
      "info",
    );
    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    const messages = sendUserMessage.mock.calls[0][0];
    expect(messages[0].text).toContain("DEFINE_PROMPT_CONTENT");
    expect(messages[1].text).toContain("research output");
    expect(messages[1].text).toContain("https://github.com/o/r/issues/5");
  });

  it("proceeds with placeholder when research fails", async () => {
    mockRun.mockRejectedValue(new Error("exec timeout"));
    const notify = vi.fn();
    const sendUserMessage = vi.fn().mockResolvedValue(undefined);
    mockPi.sendUserMessage = sendUserMessage;

    const phase = new DefinePhase(mockPi);

    await phase.handler("https://github.com/o/r/issues/5", {
      ui: { notify },
      sessionManager: { getEntries: () => [] },
      cwd: "/project",
    } as never);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Background research failed"),
      "warning",
    );

    const messages = sendUserMessage.mock.calls[0][0];
    expect(messages[1].text).toContain("could not be completed");
  });

  it("handles null sessionManager gracefully", async () => {
    const notify = vi.fn();
    const sendUserMessage = vi.fn().mockResolvedValue(undefined);
    mockPi.sendUserMessage = sendUserMessage;

    const phase = new DefinePhase(mockPi);

    await phase.handler("https://github.com/o/r/issues/5", {
      ui: { notify },
      sessionManager: null,
      cwd: "/project",
    } as never);

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
  });
});
