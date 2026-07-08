import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { activateSpecResolution } from "./spec-resolution";

/**
 * Integration tests for the child-side spec resolution flow:
 *
 *   FORGE_SPEC JSON → DynamicAgentSpecification.fromJSON() →
 *     pi.setActiveTools() + activateToolRestrictions() + before_agent_start hook
 *
 * This is the code path exercised by activateSpecResolution in spec-resolution.ts
 * when a child subprocess is spawned with FORGE_SPEC set to a full spec JSON.
 */

function makeMockPiWithHandlers(defaultTools: string[] = []) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const activeTools: string[] = [...defaultTools];

  return {
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(event, handler);
    }),
    setActiveTools: vi.fn((tools: string[]) => {
      activeTools.length = 0;
      activeTools.push(...tools);
    }),
    getActiveTools: vi.fn(() => [...activeTools]),
    setThinkingLevel: vi.fn(),
    getHandler: (event: string) => handlers.get(event),
  };
}

function makeBashToolCallEvent(command: string) {
  return {
    type: "tool_call" as const,
    toolCallId: "call-1",
    toolName: "bash" as const,
    input: { command },
  };
}

function makeSpecJSON(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "test-spec",
    role: "test-spec",
    systemPrompt: "Test agent",
    tools: ["read", "grep", "ls"],
    toolRestrictions: {},
    excludedTools: [],
    ...overrides,
  });
}

describe("activateSpecResolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.FORGE_SPEC;
  });

  describe("hook registration", () => {
    it("registers both session_start and before_agent_start hooks", () => {
      const pi = makeMockPiWithHandlers();
      activateSpecResolution(pi as unknown as ExtensionAPI);

      expect(pi.on).toHaveBeenCalledWith("before_agent_start", expect.any(Function));
      expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    });
  });

  describe("FORGE_SPEC resolution", () => {
    it("activates tool restrictions and sets tools when FORGE_SPEC resolves", () => {
      const pi = makeMockPiWithHandlers();
      activateSpecResolution(pi as unknown as ExtensionAPI);

      process.env.FORGE_SPEC = makeSpecJSON({
        tools: ["read", "grep", "ls", "bash"],
        toolRestrictions: { bash: ["git *", "npm *"] },
        systemPrompt: "Test agent with restricted bash",
      });

      const sessionStartHandler = pi.getHandler("session_start");
      sessionStartHandler!();

      // Verify tools were set
      expect(pi.getActiveTools()).toEqual(["read", "grep", "ls", "bash"]);

      // Verify tool restriction interceptor was registered
      const toolCallHandler = pi.getHandler("tool_call");
      expect(toolCallHandler).toBeDefined();

      // Allowed commands pass through
      expect(toolCallHandler!(makeBashToolCallEvent("git status"))).toBeUndefined();
      expect(toolCallHandler!(makeBashToolCallEvent("npm test"))).toBeUndefined();

      // Disallowed commands are blocked
      expect(toolCallHandler!(makeBashToolCallEvent("rm -rf /"))).toEqual({
        block: true,
        reason: expect.stringContaining("rm -rf /"),
      });

      // Non-bash tool calls pass through
      expect(
        toolCallHandler!({
          type: "tool_call" as const,
          toolCallId: "call-2",
          toolName: "read",
          input: { path: "file.txt" },
        }),
      ).toBeUndefined();
    });

    it("does not activate tool restrictions when spec has empty toolRestrictions", () => {
      const pi = makeMockPiWithHandlers();
      activateSpecResolution(pi as unknown as ExtensionAPI);

      process.env.FORGE_SPEC = makeSpecJSON({
        tools: ["read", "bash"],
        toolRestrictions: {},
        systemPrompt: "Agent with full bash access",
      });

      const sessionStartHandler = pi.getHandler("session_start");
      sessionStartHandler!();

      // activateToolRestrictions should not register a handler for empty restrictions
      expect(pi.getHandler("tool_call")).toBeUndefined();
    });

    it("sets tools correctly when spec has no bash tool", () => {
      const pi = makeMockPiWithHandlers();
      activateSpecResolution(pi as unknown as ExtensionAPI);

      process.env.FORGE_SPEC = makeSpecJSON({
        tools: ["read", "grep", "ls"],
        toolRestrictions: {},
        systemPrompt: "Read-only agent",
      });

      const sessionStartHandler = pi.getHandler("session_start");
      sessionStartHandler!();

      expect(pi.getActiveTools()).toEqual(["read", "grep", "ls"]);
      expect(pi.getHandler("tool_call")).toBeUndefined();
    });

    it("returns undefined from before_agent_start when FORGE_SPEC is not set", () => {
      const pi = makeMockPiWithHandlers();
      activateSpecResolution(pi as unknown as ExtensionAPI);

      // FORGE_SPEC not set → before_agent_start returns undefined
      const beforeAgentStartHandler = pi.getHandler("before_agent_start");
      expect(beforeAgentStartHandler).toBeDefined();

      const result = beforeAgentStartHandler!({ systemPrompt: "Default" });
      expect(result).toBeUndefined();
    });

    it("returns spec systemPrompt from before_agent_start after FORGE_SPEC resolves", () => {
      const pi = makeMockPiWithHandlers();
      activateSpecResolution(pi as unknown as ExtensionAPI);

      process.env.FORGE_SPEC = makeSpecJSON({
        systemPrompt: "Child agent system prompt",
      });

      const sessionStartHandler = pi.getHandler("session_start");
      sessionStartHandler!();

      const beforeAgentStartHandler = pi.getHandler("before_agent_start");
      const result = beforeAgentStartHandler!({ systemPrompt: "Default" });
      expect(result).toEqual({ systemPrompt: "Child agent system prompt" });
    });
  });

  describe("excludedTools", () => {
    it("filters excludedTools from explicit allowlist when both are non-empty", () => {
      const pi = makeMockPiWithHandlers();
      activateSpecResolution(pi as unknown as ExtensionAPI);

      process.env.FORGE_SPEC = makeSpecJSON({
        tools: ["read", "grep", "ls", "bash", "write"],
        excludedTools: ["bash", "write"],
      });

      const sessionStartHandler = pi.getHandler("session_start");
      sessionStartHandler!();

      expect(pi.getActiveTools()).toEqual(["read", "grep", "ls"]);
    });

    it("filters excludedTools from default active tools when allowlist is empty", () => {
      const pi = makeMockPiWithHandlers(["read", "grep", "ls", "bash", "edit", "write"]);
      activateSpecResolution(pi as unknown as ExtensionAPI);

      process.env.FORGE_SPEC = makeSpecJSON({
        tools: [],
        excludedTools: ["bash", "write"],
      });

      const sessionStartHandler = pi.getHandler("session_start");
      sessionStartHandler!();

      expect(pi.getActiveTools()).toEqual(["read", "grep", "ls", "edit"]);
    });

    it("does nothing when excludedTools is empty and tools is empty", () => {
      const pi = makeMockPiWithHandlers(["read", "bash"]);
      activateSpecResolution(pi as unknown as ExtensionAPI);

      process.env.FORGE_SPEC = makeSpecJSON({
        tools: [],
        excludedTools: [],
      });

      const sessionStartHandler = pi.getHandler("session_start");
      sessionStartHandler!();

      // No call to setActiveTools when neither tools nor excludedTools are set
      expect(pi.setActiveTools).not.toHaveBeenCalled();
      // Default tools remain unchanged
      expect(pi.getActiveTools()).toEqual(["read", "bash"]);
    });

    it("excludes tools even when they are not in the default set", () => {
      const pi = makeMockPiWithHandlers(["read", "grep", "ls"]);
      activateSpecResolution(pi as unknown as ExtensionAPI);

      process.env.FORGE_SPEC = makeSpecJSON({
        tools: [],
        excludedTools: ["bash", "write"],
      });

      const sessionStartHandler = pi.getHandler("session_start");
      sessionStartHandler!();

      // bash and write were not in defaults, so exclusion doesn't change anything
      expect(pi.getActiveTools()).toEqual(["read", "grep", "ls"]);
    });

    it("handles empty excludedTools alongside explicit allowlist", () => {
      const pi = makeMockPiWithHandlers();
      activateSpecResolution(pi as unknown as ExtensionAPI);

      process.env.FORGE_SPEC = makeSpecJSON({
        tools: ["read", "grep", "ls"],
        excludedTools: [],
      });

      const sessionStartHandler = pi.getHandler("session_start");
      sessionStartHandler!();

      // No filtering needed, uses allowlist as-is
      expect(pi.getActiveTools()).toEqual(["read", "grep", "ls"]);
    });

    it("handles excludedTools that remove all tools from the allowlist", () => {
      const pi = makeMockPiWithHandlers();
      activateSpecResolution(pi as unknown as ExtensionAPI);

      process.env.FORGE_SPEC = makeSpecJSON({
        tools: ["bash", "write"],
        excludedTools: ["bash", "write"],
      });

      const sessionStartHandler = pi.getHandler("session_start");
      sessionStartHandler!();

      expect(pi.getActiveTools()).toEqual([]);
    });
  });

  describe("thinkingLevel", () => {
    it("calls pi.setThinkingLevel with the thinkingLevel from FORGE_SPEC", () => {
      const pi = makeMockPiWithHandlers();
      activateSpecResolution(pi as unknown as ExtensionAPI);

      process.env.FORGE_SPEC = makeSpecJSON({ thinkingLevel: "high" });
      const sessionStartHandler = pi.getHandler("session_start");
      sessionStartHandler!();

      expect(pi.setThinkingLevel).toHaveBeenCalledWith("high");
    });

    it("passes through each ThinkingLevel variant correctly", () => {
      const pi = makeMockPiWithHandlers();
      activateSpecResolution(pi as unknown as ExtensionAPI);

      const levels = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

      for (const level of levels) {
        vi.clearAllMocks();
        process.env.FORGE_SPEC = makeSpecJSON({ thinkingLevel: level });
        const handler = pi.getHandler("session_start");
        handler!();
        expect(pi.setThinkingLevel).toHaveBeenCalledWith(level);
      }
    });

    it("does not call pi.setThinkingLevel when thinkingLevel is omitted from FORGE_SPEC", () => {
      const pi = makeMockPiWithHandlers();
      activateSpecResolution(pi as unknown as ExtensionAPI);

      process.env.FORGE_SPEC = makeSpecJSON({ tools: ["read"] });
      const sessionStartHandler = pi.getHandler("session_start");
      sessionStartHandler!();

      expect(pi.setThinkingLevel).not.toHaveBeenCalled();
    });

    it("does not call pi.setThinkingLevel when thinkingLevel is undefined", () => {
      const pi = makeMockPiWithHandlers();
      activateSpecResolution(pi as unknown as ExtensionAPI);

      process.env.FORGE_SPEC = makeSpecJSON({ thinkingLevel: undefined });
      const sessionStartHandler = pi.getHandler("session_start");
      sessionStartHandler!();

      expect(pi.setThinkingLevel).not.toHaveBeenCalled();
    });
  });

  describe("session_start edge cases", () => {
    it("does nothing when FORGE_SPEC env var is not set", () => {
      const pi = makeMockPiWithHandlers();
      activateSpecResolution(pi as unknown as ExtensionAPI);

      const sessionStartHandler = pi.getHandler("session_start");
      sessionStartHandler!();

      // No tools should have been set
      expect(pi.setActiveTools).not.toHaveBeenCalled();
      expect(pi.getActiveTools()).toEqual([]);
    });

    it("does nothing when FORGE_SPEC is empty string", () => {
      const pi = makeMockPiWithHandlers();
      activateSpecResolution(pi as unknown as ExtensionAPI);

      process.env.FORGE_SPEC = "";
      const sessionStartHandler = pi.getHandler("session_start");
      sessionStartHandler!();

      expect(pi.setActiveTools).not.toHaveBeenCalled();
    });

    it("handles malformed FORGE_SPEC JSON gracefully", () => {
      const pi = makeMockPiWithHandlers();
      activateSpecResolution(pi as unknown as ExtensionAPI);

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      process.env.FORGE_SPEC = "{invalid";
      const sessionStartHandler = pi.getHandler("session_start");
      sessionStartHandler!();

      expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to deserialize FORGE_SPEC", {
        error: expect.any(String),
      });
      expect(pi.setActiveTools).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });
});
