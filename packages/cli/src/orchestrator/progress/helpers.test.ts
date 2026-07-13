import { describe, expect, it } from "vitest";

import { extractMessageText, getNestedString, getStatusIcon, serializeToolArgs } from "./helpers";

describe("getStatusIcon", () => {
  it('returns success icon for "done" status', () => {
    expect(getStatusIcon("done")).toEqual({ char: "✓", color: "success" });
  });

  it('returns success icon for "done" status with passed: true', () => {
    expect(getStatusIcon("done", true)).toEqual({ char: "✓", color: "success" });
  });

  it('returns error icon for "done" status with passed: false', () => {
    expect(getStatusIcon("done", false)).toEqual({ char: "✗", color: "error" });
  });

  it('returns accent spinner for "running" status', () => {
    expect(getStatusIcon("running")).toEqual({ char: "⟳", color: "accent" });
  });

  it('returns warning icon for "started" status', () => {
    expect(getStatusIcon("started")).toEqual({ char: "⏳", color: "warning" });
  });

  it('returns error icon for "error" status', () => {
    expect(getStatusIcon("error")).toEqual({ char: "✗", color: "error" });
  });

  it("returns default muted icon for undefined status", () => {
    expect(getStatusIcon(undefined)).toEqual({ char: "○", color: "muted" });
  });

  it("returns default muted icon for unknown status", () => {
    expect(getStatusIcon("unknown")).toEqual({ char: "○", color: "muted" });
  });
});

describe("extractMessageText", () => {
  it("returns the string directly when message is a plain string", () => {
    expect(extractMessageText("hello world")).toBe("hello world");
  });

  it("returns content field when message is an object with string content", () => {
    expect(extractMessageText({ content: "hello world" })).toBe("hello world");
  });

  it("concatenates text blocks from content array", () => {
    const message = {
      content: [
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
        { type: "tool_use", id: "t1" },
      ],
    };
    expect(extractMessageText(message)).toBe("hello world");
  });

  it("returns empty string for null message", () => {
    expect(extractMessageText(null)).toBe("");
  });

  it("returns empty string for undefined message", () => {
    expect(extractMessageText(undefined)).toBe("");
  });

  it("returns empty string when content is not a string or array", () => {
    expect(extractMessageText({ content: 42 })).toBe("");
  });

  it("returns empty string when content array is empty", () => {
    expect(extractMessageText({ content: [] })).toBe("");
  });

  it("returns empty string for non-object non-string message", () => {
    expect(extractMessageText(42)).toBe("");
  });

  it("handles blocks without text property", () => {
    expect(extractMessageText({ content: [{ type: "image" }] })).toBe("");
  });

  it("handles blocks where text is not a string", () => {
    expect(extractMessageText({ content: [{ type: "text", text: 123 }] })).toBe("");
  });

  it("handles null blocks in content array", () => {
    expect(
      extractMessageText({
        content: [null, { type: "text", text: "valid" }],
      }),
    ).toBe("valid");
  });
});

describe("serializeToolArgs", () => {
  it("returns the string when args is already a string", () => {
    expect(serializeToolArgs("hello")).toBe("hello");
  });

  it("serializes a plain object as formatted JSON", () => {
    const result = serializeToolArgs({ command: "ls", cwd: "/tmp" });
    expect(result).toContain('"command"');
    expect(result).toContain("ls");
    expect(result).toContain('"cwd"');
    expect(result).toContain("/tmp");
  });

  it("serializes a number as a string", () => {
    const result = serializeToolArgs(42);
    expect(result).toBe("42");
  });

  it("serializes null as string null", () => {
    const result = serializeToolArgs(null);
    expect(result).toBe("null");
  });

  it("serializes an array as JSON", () => {
    const result = serializeToolArgs(["a", "b"]);
    expect(result).toContain('"a"');
    expect(result).toContain('"b"');
  });

  it("falls back to String() for non-serializable values", () => {
    const bigInt = BigInt(123);
    const result = serializeToolArgs(bigInt);
    expect(result).toBe("123");
  });
});

describe("getNestedString", () => {
  it("retrieves a top-level string property", () => {
    expect(getNestedString({ role: "assistant" }, "role")).toBe("assistant");
  });

  it("walks a dotted key path", () => {
    expect(getNestedString({ message: { role: "user" } }, "message", "role")).toBe("user");
  });

  it("returns empty string when intermediate key is missing", () => {
    expect(getNestedString({ message: {} }, "message", "role")).toBe("");
  });

  it("returns empty string for null root", () => {
    expect(getNestedString(null, "key")).toBe("");
  });

  it("returns empty string for undefined root", () => {
    expect(getNestedString(undefined, "key")).toBe("");
  });

  it("returns empty string when intermediate value is not an object", () => {
    expect(getNestedString({ message: "hello" }, "message", "role")).toBe("");
  });

  it("returns empty string when final value is not a string", () => {
    expect(getNestedString({ key: 42 }, "key")).toBe("");
  });

  it("returns empty string when first key is missing", () => {
    expect(getNestedString({}, "missing")).toBe("");
  });

  it("handles boolean values", () => {
    expect(getNestedString({ flag: true }, "flag")).toBe("");
  });
});
