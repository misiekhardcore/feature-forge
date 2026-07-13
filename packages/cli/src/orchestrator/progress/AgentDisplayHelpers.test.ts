import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";

import { AgentDisplayHelpers } from "./AgentDisplayHelpers";

describe("getStatusIcon", () => {
  it('returns success icon for "done" status', () => {
    expect(AgentDisplayHelpers.getStatusIcon("done")).toEqual({ char: "✓", color: "success" });
  });

  it('returns success icon for "done" status with passed: true', () => {
    expect(AgentDisplayHelpers.getStatusIcon("done", true)).toEqual({
      char: "✓",
      color: "success",
    });
  });

  it('returns error icon for "done" status with passed: false', () => {
    expect(AgentDisplayHelpers.getStatusIcon("done", false)).toEqual({ char: "✗", color: "error" });
  });

  it('returns accent spinner for "running" status', () => {
    expect(AgentDisplayHelpers.getStatusIcon("running")).toEqual({ char: "⟳", color: "accent" });
  });

  it('returns warning icon for "started" status', () => {
    expect(AgentDisplayHelpers.getStatusIcon("started")).toEqual({ char: "⏳", color: "warning" });
  });

  it('returns error icon for "error" status', () => {
    expect(AgentDisplayHelpers.getStatusIcon("error")).toEqual({ char: "✗", color: "error" });
  });

  it("returns default muted icon for undefined status", () => {
    expect(AgentDisplayHelpers.getStatusIcon(undefined)).toEqual({ char: "○", color: "muted" });
  });

  it("returns default muted icon for unknown status", () => {
    expect(AgentDisplayHelpers.getStatusIcon("unknown")).toEqual({ char: "○", color: "muted" });
  });
});

describe("extractMessageText", () => {
  it("returns content field when message has string content", () => {
    const msg = { role: "user", content: "hello world", timestamp: 0 } as AgentMessage;
    expect(AgentDisplayHelpers.extractMessageText(msg)).toBe("hello world");
  });

  it("concatenates text blocks from content array", () => {
    const message = {
      role: "user",
      content: [
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
        { type: "tool_use", id: "t1" },
      ],
      timestamp: 0,
    } as AgentMessage;
    expect(AgentDisplayHelpers.extractMessageText(message)).toBe("hello world");
  });

  it("returns empty string when content array is empty", () => {
    const msg = { role: "user", content: [], timestamp: 0 } as AgentMessage;
    expect(AgentDisplayHelpers.extractMessageText(msg)).toBe("");
  });

  it("handles blocks without text property", () => {
    const msg = { role: "user", content: [{ type: "image" }], timestamp: 0 } as AgentMessage;
    expect(AgentDisplayHelpers.extractMessageText(msg)).toBe("");
  });
});

describe("serializeToolArgs", () => {
  it("returns the string when args is already a string", () => {
    expect(AgentDisplayHelpers.serializeToolArgs("hello")).toBe("hello");
  });

  it("serializes a plain object as formatted JSON", () => {
    const result = AgentDisplayHelpers.serializeToolArgs({ command: "ls", cwd: "/tmp" });
    expect(result).toContain('"command"');
    expect(result).toContain("ls");
    expect(result).toContain('"cwd"');
    expect(result).toContain("/tmp");
  });

  it("serializes a number as a string", () => {
    const result = AgentDisplayHelpers.serializeToolArgs(42);
    expect(result).toBe("42");
  });

  it("serializes null as string null", () => {
    const result = AgentDisplayHelpers.serializeToolArgs(null);
    expect(result).toBe("null");
  });

  it("serializes an array as JSON", () => {
    const result = AgentDisplayHelpers.serializeToolArgs(["a", "b"]);
    expect(result).toContain('"a"');
    expect(result).toContain('"b"');
  });

  it("falls back to String() for non-serializable values", () => {
    const bigInt = BigInt(123);
    const result = AgentDisplayHelpers.serializeToolArgs(bigInt);
    expect(result).toBe("123");
  });
});
