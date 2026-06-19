import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI, SessionEntry, CustomEntry } from "@earendil-works/pi-coding-agent";

vi.mock("../.pi/extensions/feature-forge/commands/discover", () => ({
  registerDiscover: vi.fn(),
}));
vi.mock("../.pi/extensions/feature-forge/commands/define", () => ({
  registerDefine: vi.fn(),
}));

import featureForge from "../.pi/extensions/feature-forge/index";

function pipelineEntry(data: Record<string, unknown>): CustomEntry<Record<string, unknown>> {
  return {
    type: "custom" as const,
    customType: "pipeline-issue",
    data,
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

  it("registers both discover and define commands", async () => {
    const { registerDiscover } = await import("../.pi/extensions/feature-forge/commands/discover");
    const { registerDefine } = await import("../.pi/extensions/feature-forge/commands/define");

    featureForge(mockPi as unknown as ExtensionAPI);

    expect(registerDiscover).toHaveBeenCalledWith(mockPi);
    expect(registerDefine).toHaveBeenCalledWith(mockPi);
  });

  it("registers session_start event handler", () => {
    featureForge(mockPi as unknown as ExtensionAPI);

    expect(mockPi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
  });

  it("registers tool_result event handler", () => {
    featureForge(mockPi as unknown as ExtensionAPI);

    expect(mockPi.on).toHaveBeenCalledWith("tool_result", expect.any(Function));
  });

  describe("session_start handler", () => {
    it("reconstructs state when pipeline-issue entry exists", () => {
      featureForge(mockPi as unknown as ExtensionAPI);

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
      featureForge(mockPi as unknown as ExtensionAPI);

      const handler = mockPi._events.get("session_start")!;
      const sessionManager = {
        getEntries: (): SessionEntry[] => [],
      };

      expect(() => handler({}, { sessionManager })).not.toThrow();
    });
  });

  describe("tool_result handler", () => {
    it("captures issue URL from gh issue create output", () => {
      featureForge(mockPi as unknown as ExtensionAPI);

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
      featureForge(mockPi as unknown as ExtensionAPI);

      const handler = mockPi._events.get("tool_result")!;
      handler({ toolName: "read", isError: false, content: [] });

      expect(mockPi.appendEntry).not.toHaveBeenCalled();
    });

    it("ignores error tool results", () => {
      featureForge(mockPi as unknown as ExtensionAPI);

      const handler = mockPi._events.get("tool_result")!;
      handler({
        toolName: "bash",
        isError: true,
        content: [{ type: "text", text: "https://github.com/o/r/issues/1" }],
      });

      expect(mockPi.appendEntry).not.toHaveBeenCalled();
    });

    it("ignores output without github issue URL", () => {
      featureForge(mockPi as unknown as ExtensionAPI);

      const handler = mockPi._events.get("tool_result")!;
      handler({
        toolName: "bash",
        isError: false,
        content: [{ type: "text", text: "No issues here" }],
      });

      expect(mockPi.appendEntry).not.toHaveBeenCalled();
    });
  });
});
