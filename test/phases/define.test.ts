import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const { mockWriteFileSync, mockUnlinkSync, mockExecSync } = vi.hoisted(() => ({
  mockWriteFileSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
  mockExecSync: vi.fn(),
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
  writeFileSync: mockWriteFileSync,
  unlinkSync: mockUnlinkSync,
}));

vi.mock("node:child_process", () => ({
  execSync: mockExecSync,
}));

import { DefinePhase } from "../../.pi/extensions/feature-forge/phases/define";

// ---------------------------------------------------------------------------
// DefinePhase (research)
// ---------------------------------------------------------------------------
describe("DefinePhase - research", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.removeAllListeners("exit");
  });

  it("writes research agent prompt to a temp file and executes pi -p", () => {
    mockExecSync.mockReturnValue("## Research results\n\nFound some things.");

    const phase = new DefinePhase();
    // Access the private research method by casting
    const result = (
      phase as { runBackgroundResearch(issueRef: string, cwd: string): string }
    ).runBackgroundResearch("https://github.com/o/r/issues/1", "/fake/cwd");

    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const writtenPath = mockWriteFileSync.mock.calls[0][0] as string;
    expect(writtenPath).toContain("ff-define-research-");
    expect(writtenPath).toContain(".txt");

    expect(mockExecSync).toHaveBeenCalledTimes(1);
    const cmd = mockExecSync.mock.calls[0][0] as string;
    expect(cmd).toContain("pi -p");

    expect(mockUnlinkSync).toHaveBeenCalledWith(writtenPath);
    expect(result).toBe("## Research results\n\nFound some things.");
  });

  it("passes encoding, cwd, timeout, maxBuffer, and shell options to execSync", () => {
    mockExecSync.mockReturnValue("ok");

    const phase = new DefinePhase();
    (
      phase as { runBackgroundResearch(issueRef: string, cwd: string): string }
    ).runBackgroundResearch("https://github.com/o/r/issues/1", "/my/project");

    const opts = mockExecSync.mock.calls[0][1];
    expect(opts).toMatchObject({
      encoding: "utf-8",
      cwd: "/my/project",
      timeout: 180_000,
      maxBuffer: 5 * 1024 * 1024,
      shell: "/bin/bash",
    });
  });

  it("cleans up temp file even when execSync throws", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("pi not found");
    });

    const phase = new DefinePhase();
    expect(() =>
      (
        phase as { runBackgroundResearch(issueRef: string, cwd: string): string }
      ).runBackgroundResearch("https://github.com/o/r/issues/1", "/cwd"),
    ).toThrow("pi not found");

    const writtenPath = mockWriteFileSync.mock.calls[0][0] as string;
    expect(mockUnlinkSync).toHaveBeenCalledWith(writtenPath);
  });

  it("does not crash when unlink fails (swallowed error)", () => {
    mockExecSync.mockReturnValue("ok");
    mockUnlinkSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const phase = new DefinePhase();
    expect(() =>
      (
        phase as { runBackgroundResearch(issueRef: string, cwd: string): string }
      ).runBackgroundResearch("https://github.com/o/r/issues/1", "/cwd"),
    ).not.toThrow();
  });

  it("registers process exit cleanup handler", () => {
    const onceSpy = vi.spyOn(process, "once");
    const offSpy = vi.spyOn(process, "off");
    mockExecSync.mockReturnValue("ok");

    const phase = new DefinePhase();
    (
      phase as { runBackgroundResearch(issueRef: string, cwd: string): string }
    ).runBackgroundResearch("https://github.com/o/r/issues/1", "/cwd");

    expect(onceSpy).toHaveBeenCalledWith("exit", expect.any(Function));
    expect(offSpy).toHaveBeenCalledWith("exit", expect.any(Function));

    onceSpy.mockRestore();
    offSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// DefinePhase (handler)
// ---------------------------------------------------------------------------
describe("DefinePhase - handler", () => {
  let mockPi: ExtensionAPI;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSync.mockReturnValue("research output");

    mockPi = {
      registerCommand: vi.fn(),
      sendUserMessage: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExtensionAPI;
  });

  it("has the correct name", () => {
    const phase = new DefinePhase();
    expect(phase.name).toBe("define");
    expect(phase.description).toMatch(/implementation plan/i);
  });

  it("notifies error when no issue ref can be resolved", async () => {
    const notify = vi.fn();
    const phase = new DefinePhase();
    phase.pi = mockPi;

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

    const phase = new DefinePhase();
    phase.pi = mockPi;

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
    mockExecSync.mockImplementation(() => {
      throw new Error("exec timeout");
    });
    const notify = vi.fn();
    const sendUserMessage = vi.fn().mockResolvedValue(undefined);
    mockPi.sendUserMessage = sendUserMessage;

    const phase = new DefinePhase();
    phase.pi = mockPi;

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

    const phase = new DefinePhase();
    phase.pi = mockPi;

    await phase.handler("https://github.com/o/r/issues/5", {
      ui: { notify },
      sessionManager: null,
      cwd: "/project",
    } as never);

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
  });
});
