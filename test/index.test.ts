import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI, SessionEntry, CustomEntry } from "@earendil-works/pi-coding-agent";

vi.mock("../.pi/extensions/feature-forge/phases/registry", () => ({
  registerPhases: vi.fn(),
}));

import featureForge from "../.pi/extensions/feature-forge/index";
import { PipelineState } from "../.pi/extensions/feature-forge/state";

function pipelineEntry(data: PipelineState): CustomEntry<PipelineState> {
  return {
    type: "custom" as const,
    customType: "pipeline-issue",
    data,
    id: "test-id",
    parentId: null,
    timestamp: new Date().toISOString(),
  };
}

describe("feature-forge extension", () => {
  let mockPi: ExtensionAPI & {
    _events: Map<string, (...args: unknown[]) => void>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    const events = new Map<string, (...args: unknown[]) => void>();

    mockPi = {
      _events: events,
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        events.set(event, handler);
      }),
      registerCommand: vi.fn(),
      sendUserMessage: vi.fn().mockResolvedValue(undefined),
      appendEntry: vi.fn(),
    } as unknown as typeof mockPi;
  });

  it("registers all three phases via registerPhases", async () => {
    const { registerPhases } = await import("../.pi/extensions/feature-forge/phases/registry");

    featureForge(mockPi);

    expect(registerPhases).toHaveBeenCalledWith(
      mockPi,
      expect.arrayContaining([expect.anything()]),
    );
    const phases = (registerPhases as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(phases).toHaveLength(3);
    expect(phases[0].name).toBe("discover");
    expect(phases[1].name).toBe("define");
    expect(phases[2].name).toBe("implement");
  });

  it("registers session_start event handler", () => {
    featureForge(mockPi);

    expect(mockPi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
  });

  it("registers tool_result event handler", () => {
    featureForge(mockPi);

    expect(mockPi.on).toHaveBeenCalledWith("tool_result", expect.any(Function));
  });

  describe("session_start handler", () => {
    it("reconstructs state when pipeline-issue entry exists", () => {
      featureForge(mockPi);

      const handler = mockPi._events.get("session_start")!;
      const sessionManager = {
        getEntries: (): SessionEntry[] => [
          pipelineEntry({ issueUrl: "https://github.com/o/r/issues/42" }),
        ],
      };

      handler({}, { sessionManager });

      expect(mockPi.appendEntry).not.toHaveBeenCalled();
    });

    it("does nothing when no pipeline-issue entry exists", () => {
      featureForge(mockPi);

      const handler = mockPi._events.get("session_start")!;
      const sessionManager = {
        getEntries: (): SessionEntry[] => [],
      };

      expect(() => handler({}, { sessionManager })).not.toThrow();
    });
  });

  describe("tool_result handler", () => {
    it("captures issue URL from gh issue create output", () => {
      featureForge(mockPi);

      const handler = mockPi._events.get("tool_result")!;
      const event = {
        toolName: "bash",
        isError: false,
        content: [{ type: "text", text: "Created issue https://github.com/owner/repo/issues/123" }],
      };

      handler(event);

      expect(mockPi.appendEntry).toHaveBeenCalledWith(
        "pipeline-issue",
        expect.objectContaining({
          issueUrl: "https://github.com/owner/repo/issues/123",
          issueNumber: 123,
        }),
      );
    });

    it("ignores non-bash tool results", () => {
      featureForge(mockPi);

      const handler = mockPi._events.get("tool_result")!;
      handler({ toolName: "read", isError: false, content: [] });

      expect(mockPi.appendEntry).not.toHaveBeenCalled();
    });

    it("ignores error tool results", () => {
      featureForge(mockPi);

      const handler = mockPi._events.get("tool_result")!;
      handler({
        toolName: "bash",
        isError: true,
        content: [{ type: "text", text: "https://github.com/o/r/issues/1" }],
      });

      expect(mockPi.appendEntry).not.toHaveBeenCalled();
    });

    it("ignores output without github issue URL", () => {
      featureForge(mockPi);

      const handler = mockPi._events.get("tool_result")!;
      handler({
        toolName: "bash",
        isError: false,
        content: [{ type: "text", text: "No issues here" }],
      });

      expect(mockPi.appendEntry).not.toHaveBeenCalled();
    });

    it("captures PR URL from gh pr create output", () => {
      featureForge(mockPi);

      const handler = mockPi._events.get("tool_result")!;
      handler({
        toolName: "bash",
        isError: false,
        content: [
          {
            type: "text",
            text: "https://github.com/owner/repo/pull/456",
          },
        ],
      });

      expect(mockPi.appendEntry).toHaveBeenCalledWith(
        "pipeline-issue",
        expect.objectContaining({
          prUrl: "https://github.com/owner/repo/pull/456",
          prNumber: 456,
        }),
      );
    });

    it("preserves existing issue state when capturing PR URL", () => {
      featureForge(mockPi);

      // First capture issue URL
      const handler = mockPi._events.get("tool_result")!;
      handler({
        toolName: "bash",
        isError: false,
        content: [{ type: "text", text: "https://github.com/o/r/issues/1" }],
      });

      // Then capture PR URL — should preserve the issue state
      handler({
        toolName: "bash",
        isError: false,
        content: [{ type: "text", text: "https://github.com/o/r/pull/100" }],
      });

      // Should have been called twice: once for issue, once for PR
      expect(mockPi.appendEntry).toHaveBeenCalledTimes(2);
      const lastCall = (mockPi.appendEntry as ReturnType<typeof vi.fn>).mock.calls[1];
      expect(lastCall[1]).toMatchObject({
        issueUrl: "https://github.com/o/r/issues/1",
        issueNumber: 1,
        prUrl: "https://github.com/o/r/pull/100",
        prNumber: 100,
      });
    });

    it("prioritizes issue URL capture over PR URL when both present", () => {
      featureForge(mockPi);

      const handler = mockPi._events.get("tool_result")!;
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

      // Issue check runs first and returns early — should capture issue, not PR
      expect(mockPi.appendEntry).toHaveBeenCalledWith(
        "pipeline-issue",
        expect.objectContaining({
          issueUrl: "https://github.com/o/r/issues/1",
          issueNumber: 1,
        }),
      );
    });
  });
});
