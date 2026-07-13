import { describe, expect, it } from "vitest";

import { StreamHelpers } from "./StreamHelpers";

describe("StreamHelpers.getStatusIcon", () => {
  it('returns success icon for "done" status', () => {
    expect(StreamHelpers.getStatusIcon("done")).toEqual({ char: "✓", color: "success" });
  });

  it('returns success icon for "done" status with passed: true', () => {
    expect(StreamHelpers.getStatusIcon("done", true)).toEqual({ char: "✓", color: "success" });
  });

  it('returns error icon for "done" status with passed: false', () => {
    expect(StreamHelpers.getStatusIcon("done", false)).toEqual({ char: "✗", color: "error" });
  });

  it('returns accent spinner for "running" status', () => {
    expect(StreamHelpers.getStatusIcon("running")).toEqual({ char: "⟳", color: "accent" });
  });

  it('returns warning icon for "started" status', () => {
    expect(StreamHelpers.getStatusIcon("started")).toEqual({ char: "⏳", color: "warning" });
  });

  it('returns error icon for "error" status', () => {
    expect(StreamHelpers.getStatusIcon("error")).toEqual({ char: "✗", color: "error" });
  });

  it("returns default muted icon for undefined status", () => {
    expect(StreamHelpers.getStatusIcon(undefined)).toEqual({ char: "○", color: "muted" });
  });

  it("returns default muted icon for unknown status", () => {
    expect(StreamHelpers.getStatusIcon("unknown")).toEqual({ char: "○", color: "muted" });
  });
});

describe("StreamHelpers.extractMessageText", () => {
  it("returns the string directly when message is a plain string", () => {
    expect(StreamHelpers.extractMessageText("hello world")).toBe("hello world");
  });

  it("returns content field when message is an object with string content", () => {
    expect(StreamHelpers.extractMessageText({ content: "hello world" })).toBe("hello world");
  });

  it("concatenates text blocks from content array", () => {
    const message = {
      content: [
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
        { type: "tool_use", id: "t1" },
      ],
    };
    expect(StreamHelpers.extractMessageText(message)).toBe("hello world");
  });

  it("returns empty string for null message", () => {
    expect(StreamHelpers.extractMessageText(null)).toBe("");
  });

  it("returns empty string for undefined message", () => {
    expect(StreamHelpers.extractMessageText(undefined)).toBe("");
  });

  it("returns empty string when content is not a string or array", () => {
    expect(StreamHelpers.extractMessageText({ content: 42 })).toBe("");
  });

  it("returns empty string when content array is empty", () => {
    expect(StreamHelpers.extractMessageText({ content: [] })).toBe("");
  });

  it("returns empty string for non-object non-string message", () => {
    expect(StreamHelpers.extractMessageText(42)).toBe("");
  });

  it("handles blocks without text property", () => {
    expect(StreamHelpers.extractMessageText({ content: [{ type: "image" }] })).toBe("");
  });

  it("handles blocks where text is not a string", () => {
    expect(StreamHelpers.extractMessageText({ content: [{ type: "text", text: 123 }] })).toBe("");
  });

  it("handles null blocks in content array", () => {
    expect(
      StreamHelpers.extractMessageText({
        content: [null, { type: "text", text: "valid" }],
      }),
    ).toBe("valid");
  });
});

describe("StreamHelpers.serializeToolArgs", () => {
  it("returns the string when args is already a string", () => {
    expect(StreamHelpers.serializeToolArgs("hello")).toBe("hello");
  });

  it("serializes a plain object as formatted JSON", () => {
    const result = StreamHelpers.serializeToolArgs({ command: "ls", cwd: "/tmp" });
    expect(result).toContain('"command"');
    expect(result).toContain("ls");
    expect(result).toContain('"cwd"');
    expect(result).toContain("/tmp");
  });

  it("serializes a number as a string", () => {
    const result = StreamHelpers.serializeToolArgs(42);
    expect(result).toBe("42");
  });

  it("serializes null as string null", () => {
    const result = StreamHelpers.serializeToolArgs(null);
    expect(result).toBe("null");
  });

  it("serializes an array as JSON", () => {
    const result = StreamHelpers.serializeToolArgs(["a", "b"]);
    expect(result).toContain('"a"');
    expect(result).toContain('"b"');
  });

  it("falls back to String() for non-serializable values", () => {
    const bigInt = BigInt(123);
    const result = StreamHelpers.serializeToolArgs(bigInt);
    expect(result).toBe("123");
  });
});

describe("StreamHelpers.getNestedString", () => {
  it("retrieves a top-level string property", () => {
    expect(StreamHelpers.getNestedString({ role: "assistant" }, "role")).toBe("assistant");
  });

  it("walks a dotted key path", () => {
    expect(StreamHelpers.getNestedString({ message: { role: "user" } }, "message", "role")).toBe(
      "user",
    );
  });

  it("returns empty string when intermediate key is missing", () => {
    expect(StreamHelpers.getNestedString({ message: {} }, "message", "role")).toBe("");
  });

  it("returns empty string for null root", () => {
    expect(StreamHelpers.getNestedString(null, "key")).toBe("");
  });

  it("returns empty string for undefined root", () => {
    expect(StreamHelpers.getNestedString(undefined, "key")).toBe("");
  });

  it("returns empty string when intermediate value is not an object", () => {
    expect(StreamHelpers.getNestedString({ message: "hello" }, "message", "role")).toBe("");
  });

  it("returns empty string when final value is not a string", () => {
    expect(StreamHelpers.getNestedString({ key: 42 }, "key")).toBe("");
  });

  it("returns empty string when first key is missing", () => {
    expect(StreamHelpers.getNestedString({}, "missing")).toBe("");
  });

  it("handles boolean values", () => {
    expect(StreamHelpers.getNestedString({ flag: true }, "flag")).toBe("");
  });
});
