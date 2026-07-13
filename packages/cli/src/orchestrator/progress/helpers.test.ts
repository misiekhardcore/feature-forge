import { describe, expect, it } from "vitest";

import { AgentDisplayHelpers } from "./helpers";

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
  it("returns the string directly when message is a plain string", () => {
    expect(AgentDisplayHelpers.extractMessageText("hello world")).toBe("hello world");
  });

  it("returns content field when message is an object with string content", () => {
    expect(AgentDisplayHelpers.extractMessageText({ content: "hello world" })).toBe("hello world");
  });

  it("concatenates text blocks from content array", () => {
    const message = {
      content: [
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
        { type: "tool_use", id: "t1" },
      ],
    };
    expect(AgentDisplayHelpers.extractMessageText(message)).toBe("hello world");
  });

  it("returns empty string for null message", () => {
    expect(AgentDisplayHelpers.extractMessageText(null)).toBe("");
  });

  it("returns empty string for undefined message", () => {
    expect(AgentDisplayHelpers.extractMessageText(undefined)).toBe("");
  });

  it("returns empty string when content is not a string or array", () => {
    expect(AgentDisplayHelpers.extractMessageText({ content: 42 })).toBe("");
  });

  it("returns empty string when content array is empty", () => {
    expect(AgentDisplayHelpers.extractMessageText({ content: [] })).toBe("");
  });

  it("returns empty string for non-object non-string message", () => {
    expect(AgentDisplayHelpers.extractMessageText(42)).toBe("");
  });

  it("handles blocks without text property", () => {
    expect(AgentDisplayHelpers.extractMessageText({ content: [{ type: "image" }] })).toBe("");
  });

  it("handles blocks where text is not a string", () => {
    expect(AgentDisplayHelpers.extractMessageText({ content: [{ type: "text", text: 123 }] })).toBe(
      "",
    );
  });

  it("handles null blocks in content array", () => {
    expect(
      AgentDisplayHelpers.extractMessageText({
        content: [null, { type: "text", text: "valid" }],
      }),
    ).toBe("valid");
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

describe("getNestedString", () => {
  it("retrieves a top-level string property", () => {
    expect(AgentDisplayHelpers.getNestedString({ role: "assistant" }, "role")).toBe("assistant");
  });

  it("walks a dotted key path", () => {
    expect(
      AgentDisplayHelpers.getNestedString({ message: { role: "user" } }, "message", "role"),
    ).toBe("user");
  });

  it("returns empty string when intermediate key is missing", () => {
    expect(AgentDisplayHelpers.getNestedString({ message: {} }, "message", "role")).toBe("");
  });

  it("returns empty string for null root", () => {
    expect(AgentDisplayHelpers.getNestedString(null, "key")).toBe("");
  });

  it("returns empty string for undefined root", () => {
    expect(AgentDisplayHelpers.getNestedString(undefined, "key")).toBe("");
  });

  it("returns empty string when intermediate value is not an object", () => {
    expect(AgentDisplayHelpers.getNestedString({ message: "hello" }, "message", "role")).toBe("");
  });

  it("returns empty string when final value is not a string", () => {
    expect(AgentDisplayHelpers.getNestedString({ key: 42 }, "key")).toBe("");
  });

  it("returns empty string when first key is missing", () => {
    expect(AgentDisplayHelpers.getNestedString({}, "missing")).toBe("");
  });

  it("handles boolean values", () => {
    expect(AgentDisplayHelpers.getNestedString({ flag: true }, "flag")).toBe("");
  });
});
