import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Use vi.hoisted so the mock factories can reference these before hoisting.
const { mockWriteFileSync, mockUnlinkSync, mockExecSync } = vi.hoisted(() => ({
  mockWriteFileSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
  mockExecSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  writeFileSync: mockWriteFileSync,
  unlinkSync: mockUnlinkSync,
}));

vi.mock("node:child_process", () => ({
  execSync: mockExecSync,
}));

// Mock prompts before importing the module under test.
vi.mock("../../.pi/extensions/feature-forge/prompts", () => ({
  DEFINE_PROMPT: "DEFINE_PROMPT_CONTENT",
  researchPrompt: vi.fn((url: string) => `Research prompt for: ${url}`),
}));

import {
  runBackgroundResearch,
  registerDefine,
} from "../../.pi/extensions/feature-forge/commands/define";

// ---------------------------------------------------------------------------
// runBackgroundResearch
// ---------------------------------------------------------------------------
describe("runBackgroundResearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.removeAllListeners("exit");
  });

  it("writes research prompt to a temp file and executes pi -p", () => {
    mockExecSync.mockReturnValue("## Research results\n\nFound some things.");

    const result = runBackgroundResearch("https://github.com/o/r/issues/1", "/fake/cwd");

    // Should have written the tmp file
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const writtenPath = mockWriteFileSync.mock.calls[0][0] as string;
    expect(writtenPath).toContain("ff-define-research-");
    expect(writtenPath).toContain(".txt");

    // Should have executed pi with the prompt from file
    expect(mockExecSync).toHaveBeenCalledTimes(1);
    const cmd = mockExecSync.mock.calls[0][0] as string;
    expect(cmd).toContain("pi -p");

    // Should have cleaned up
    expect(mockUnlinkSync).toHaveBeenCalledWith(writtenPath);

    // Should return execSync output
    expect(result).toBe("## Research results\n\nFound some things.");
  });

  it("passes encoding, cwd, timeout, maxBuffer, and shell options to execSync", () => {
    mockExecSync.mockReturnValue("ok");

    runBackgroundResearch("https://github.com/o/r/issues/1", "/my/project");

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

    expect(() => runBackgroundResearch("https://github.com/o/r/issues/1", "/cwd")).toThrow(
      "pi not found",
    );

    // Temp file should still be cleaned up (finally block)
    const writtenPath = mockWriteFileSync.mock.calls[0][0] as string;
    expect(mockUnlinkSync).toHaveBeenCalledWith(writtenPath);
  });

  it("does not crash when unlink fails (swallowed error)", () => {
    mockExecSync.mockReturnValue("ok");
    mockUnlinkSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    // Should not throw — unlink error is caught
    expect(() => runBackgroundResearch("https://github.com/o/r/issues/1", "/cwd")).not.toThrow();
  });

  it("registers process exit cleanup handler", () => {
    const onceSpy = vi.spyOn(process, "once");
    const offSpy = vi.spyOn(process, "off");
    mockExecSync.mockReturnValue("ok");

    runBackgroundResearch("https://github.com/o/r/issues/1", "/cwd");

    // Should register exit handler
    expect(onceSpy).toHaveBeenCalledWith("exit", expect.any(Function));
    // Should unregister after execSync succeeds
    expect(offSpy).toHaveBeenCalledWith("exit", expect.any(Function));

    onceSpy.mockRestore();
    offSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// registerDefine
// ---------------------------------------------------------------------------
describe("registerDefine", () => {
  let mockPi: ExtensionAPI;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSync.mockReturnValue("research output");

    mockPi = {
      registerCommand: vi.fn(),
      sendUserMessage: vi.fn().mockResolvedValue(undefined),
    } as unknown as ExtensionAPI;
  });

  it("registers the 'define' command", () => {
    registerDefine(mockPi);
    expect(mockPi.registerCommand).toHaveBeenCalledWith(
      "define",
      expect.objectContaining({
        description: expect.stringContaining("implementation plan"),
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

  it("runs research and sends user message when issue ref is resolved", async () => {
    const notify = vi.fn();
    const sendUserMessage = vi.fn().mockResolvedValue(undefined);
    mockPi.sendUserMessage = sendUserMessage;

    const handler = captureHandler();

    await handler("https://github.com/o/r/issues/5", {
      ui: { notify },
      sessionManager: { getEntries: () => [] },
      cwd: "/project",
    });

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

    const handler = captureHandler();

    await handler("https://github.com/o/r/issues/5", {
      ui: { notify },
      sessionManager: { getEntries: () => [] },
      cwd: "/project",
    });

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

    const handler = captureHandler();

    await handler("https://github.com/o/r/issues/5", {
      ui: { notify },
      sessionManager: null,
      cwd: "/project",
    });

    // Should not throw — null guard handles it
    expect(sendUserMessage).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Helper: capture the registered handler so we can invoke it directly
  // -----------------------------------------------------------------------
  function captureHandler(): (
    args: string | undefined,
    ctx: Record<string, unknown>,
  ) => Promise<void> {
    registerDefine(mockPi);
    const call = (mockPi.registerCommand as ReturnType<typeof vi.fn>).mock.calls[0];
    return call[1].handler as (
      args: string | undefined,
      ctx: Record<string, unknown>,
    ) => Promise<void>;
  }
});
