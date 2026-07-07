import type {
  BashToolCallEvent,
  ExtensionAPI,
  ToolCallEvent,
  ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { activate } from "./restricted-bash";

function makeMockPi(): { pi: ExtensionAPI; intercept: (event: ToolCallEvent) => void } {
  let intercept: (event: ToolCallEvent) => void = () => {};
  const pi = {
    on: (event: string, handler: (ev: ToolCallEvent) => ToolCallEventResult | undefined) => {
      if (event === "tool_call") {
        intercept = handler;
      }
    },
  } as unknown as ExtensionAPI;
  return { pi, intercept: (event: ToolCallEvent) => intercept(event) };
}

function makeBashEvent(command: string): BashToolCallEvent {
  return {
    type: "tool_call",
    toolCallId: "call-1",
    toolName: "bash",
    input: { command, timeout: 30 },
  };
}

function makeNonBashEvent(): ToolCallEvent {
  return {
    type: "tool_call",
    toolCallId: "call-2",
    toolName: "read",
    input: { path: "/tmp/test" },
  } as unknown as ToolCallEvent;
}

describe("restricted-bash", () => {
  describe("activate", () => {
    it("does nothing when patterns array is empty", () => {
      const { pi, intercept } = makeMockPi();
      activate(pi, []);
      const result = intercept(makeBashEvent("rm -rf /"));
      expect(result).toBeUndefined();
    });

    it("allows commands matching an exact pattern", () => {
      const { pi, intercept } = makeMockPi();
      activate(pi, ["npm run test:e2e"]);
      const result = intercept(makeBashEvent("npm run test:e2e"));
      expect(result).toBeUndefined();
    });

    it("blocks commands not matching any pattern", () => {
      const { pi, intercept } = makeMockPi();
      activate(pi, ["npm run test:e2e"]);
      const result = intercept(makeBashEvent("rm -rf /"));
      expect(result).toEqual({
        block: true,
        reason: expect.stringContaining("is not in the bash allowlist") as string,
      });
    });

    it("allows commands matching a glob pattern", () => {
      const { pi, intercept } = makeMockPi();
      activate(pi, ["npm run *"]);
      const result = intercept(makeBashEvent("npm run build"));
      expect(result).toBeUndefined();
    });

    it("does not allow commands that partially match a glob pattern", () => {
      const { pi, intercept } = makeMockPi();
      activate(pi, ["npm run test"]);
      const result = intercept(makeBashEvent("npm run test:e2e --verbose"));
      expect(result).toEqual({
        block: true,
        reason: expect.stringContaining("is not in the bash allowlist") as string,
      });
    });

    it("does not interfere with non-bash tools", () => {
      const { pi, intercept } = makeMockPi();
      activate(pi, ["npm run test"]);
      const result = intercept(makeNonBashEvent());
      expect(result).toBeUndefined();
    });

    it("blocks empty commands when allowlist contains only non-empty patterns", () => {
      const { pi, intercept } = makeMockPi();
      activate(pi, ["npm test"]);
      const result = intercept(makeBashEvent(""));
      expect(result).toEqual({
        block: true,
        reason: expect.stringContaining("is not in the bash allowlist") as string,
      });
    });
  });
});
