import { describe, it, expect, vi } from "vitest";
import type { ExtensionAPI, SessionEntry, CustomEntry } from "@earendil-works/pi-coding-agent";
import { State } from "../.pi/extensions/feature-forge/state";

function pipelineEntry(data: Record<string, unknown>): CustomEntry<Record<string, unknown>> {
  return {
    type: "custom" as const,
    customType: "pipeline-issue",
    data,
    id: "test-id",
    parentId: null,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// State class
// ---------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
describe("State", () => {
  function makeMockPi() {
    return {
      on: vi.fn(),
      appendEntry: vi.fn(),
    };
  }

  it("registers session_start and tool_result event handlers", () => {
    const pi = makeMockPi();
    new State(pi as unknown as ExtensionAPI);

    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("tool_result", expect.any(Function));
  });

  describe("session_start handler", () => {
    it("reconstructs state when pipeline-issue entry exists", () => {
      const pi = makeMockPi();
      new State(pi as unknown as ExtensionAPI);

      const handler = pi.on.mock.calls.find((c: unknown[]) => c[0] === "session_start")![1];
      const ctx = {
        sessionManager: {
          getEntries: (): SessionEntry[] => [
            pipelineEntry({ issueUrl: "https://github.com/o/r/issues/42" }),
          ],
        },
      };

      handler({}, ctx);

      // State is internal — no side effect to assert beyond no throw
      expect(pi.appendEntry).not.toHaveBeenCalled();
    });

    it("does nothing when no pipeline-issue entry exists", () => {
      const pi = makeMockPi();
      new State(pi as unknown as ExtensionAPI);

      const handler = pi.on.mock.calls.find((c: unknown[]) => c[0] === "session_start")![1];
      const ctx = { sessionManager: { getEntries: () => [] } };

      expect(() => handler({}, ctx)).not.toThrow();
    });
  });

  describe("tool_result handler", () => {
    it("captures issue URL from gh issue create output", () => {
      const pi = makeMockPi();
      new State(pi as unknown as ExtensionAPI);

      const handler = pi.on.mock.calls.find((c: unknown[]) => c[0] === "tool_result")![1];
      handler({
        toolName: "bash",
        isError: false,
        content: [{ type: "text", text: "Created issue https://github.com/owner/repo/issues/123" }],
      });

      expect(pi.appendEntry).toHaveBeenCalledWith(
        "pipeline-issue",
        expect.objectContaining({
          issueUrl: "https://github.com/owner/repo/issues/123",
          issueNumber: 123,
        }),
      );
    });

    it("ignores non-bash tool results", () => {
      const pi = makeMockPi();
      new State(pi as unknown as ExtensionAPI);

      const handler = pi.on.mock.calls.find((c: unknown[]) => c[0] === "tool_result")![1];
      handler({ toolName: "read", isError: false, content: [] });

      expect(pi.appendEntry).not.toHaveBeenCalled();
    });

    it("ignores error tool results", () => {
      const pi = makeMockPi();
      new State(pi as unknown as ExtensionAPI);

      const handler = pi.on.mock.calls.find((c: unknown[]) => c[0] === "tool_result")![1];
      handler({
        toolName: "bash",
        isError: true,
        content: [{ type: "text", text: "https://github.com/o/r/issues/1" }],
      });

      expect(pi.appendEntry).not.toHaveBeenCalled();
    });

    it("ignores output without github URL", () => {
      const pi = makeMockPi();
      new State(pi as unknown as ExtensionAPI);

      const handler = pi.on.mock.calls.find((c: unknown[]) => c[0] === "tool_result")![1];
      handler({
        toolName: "bash",
        isError: false,
        content: [{ type: "text", text: "No issues here" }],
      });

      expect(pi.appendEntry).not.toHaveBeenCalled();
    });

    it("captures PR URL from gh pr create output", () => {
      const pi = makeMockPi();
      new State(pi as unknown as ExtensionAPI);

      const handler = pi.on.mock.calls.find((c: unknown[]) => c[0] === "tool_result")![1];
      handler({
        toolName: "bash",
        isError: false,
        content: [{ type: "text", text: "https://github.com/owner/repo/pull/456" }],
      });

      expect(pi.appendEntry).toHaveBeenCalledWith(
        "pipeline-issue",
        expect.objectContaining({
          prUrl: "https://github.com/owner/repo/pull/456",
          prNumber: 456,
        }),
      );
    });

    it("preserves existing issue state when capturing PR URL", () => {
      const pi = makeMockPi();
      new State(pi as unknown as ExtensionAPI);

      const handler = pi.on.mock.calls.find((c: unknown[]) => c[0] === "tool_result")![1];

      // First capture issue URL
      handler({
        toolName: "bash",
        isError: false,
        content: [{ type: "text", text: "https://github.com/o/r/issues/1" }],
      });

      // Then capture PR URL
      handler({
        toolName: "bash",
        isError: false,
        content: [{ type: "text", text: "https://github.com/o/r/pull/100" }],
      });

      expect(pi.appendEntry).toHaveBeenCalledTimes(2);
      const lastCall = (pi.appendEntry as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(lastCall[1]).toMatchObject({
        issueUrl: "https://github.com/o/r/issues/1",
        issueNumber: 1,
        prUrl: "https://github.com/o/r/pull/100",
        prNumber: 100,
      });
    });

    it("prioritizes issue URL capture over PR URL when both present", () => {
      const pi = makeMockPi();
      new State(pi as unknown as ExtensionAPI);

      const handler = pi.on.mock.calls.find((c: unknown[]) => c[0] === "tool_result")![1];
      handler({
        toolName: "bash",
        isError: false,
        content: [
          {
            type: "text",
            text: "See https://github.com/o/r/pull/2 from issue https://github.com/o/r/issues/1",
          },
        ],
      });

      expect(pi.appendEntry).toHaveBeenCalledWith(
        "pipeline-issue",
        expect.objectContaining({
          issueUrl: "https://github.com/o/r/issues/1",
          issueNumber: 1,
        }),
      );
    });
  });
});
