import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";

import { AgentDisplayHelpers } from "./AgentDisplayHelpers";

describe("formatElapsed", () => {
  it("formats seconds when less than a minute", () => {
    const now = Date.now();
    const recent = new Date(now - 30 * 1000);
    const result = AgentDisplayHelpers.formatElapsed(recent);
    expect(result).toMatch(/^\d+s$/);
  });

  it("formats minutes and seconds when less than an hour", () => {
    const now = Date.now();
    const recent = new Date(now - 120 * 1000);
    const result = AgentDisplayHelpers.formatElapsed(recent);
    expect(result).toMatch(/^\d+m \d+s$/);
  });

  it("formats hours when elapsed exceeds one hour", () => {
    const now = Date.now();
    const old = new Date(now - 4000 * 1000);
    const result = AgentDisplayHelpers.formatElapsed(old);
    expect(result).toMatch(/^\d+h \d+m \d+s$/);
  });
});

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
    expect(AgentDisplayHelpers.getStatusIcon("started")).toEqual({ char: "⟳", color: "accent" });
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
    expect(AgentDisplayHelpers.extractMessageText(message)).toBe("hello\nworld");
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

describe("serializeToolResultText", () => {
  it("returns empty string for null", () => {
    expect(AgentDisplayHelpers.serializeToolResultText(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(AgentDisplayHelpers.serializeToolResultText(undefined)).toBe("");
  });

  it("returns plain string as-is", () => {
    expect(AgentDisplayHelpers.serializeToolResultText("hello world")).toBe("hello world");
  });

  it("extracts text from AgentToolResult content array", () => {
    const result = {
      content: [
        { type: "text", text: "File read successfully." },
        { type: "text", text: "Line count: 42" },
      ],
      isError: false,
    };
    const text = AgentDisplayHelpers.serializeToolResultText(result);
    expect(text).toBe("File read successfully.\nLine count: 42");
  });

  it("skips non-text content blocks in AgentToolResult", () => {
    const result = {
      content: [
        { type: "text", text: "hello" },
        { type: "tool_use", id: "t1", name: "read" },
        { type: "text", text: "world" },
      ],
    };
    expect(AgentDisplayHelpers.serializeToolResultText(result)).toBe("hello\nworld");
  });

  it("filters out blocks where text is not a string", () => {
    const result = {
      content: [
        { type: "text", text: "valid" },
        { type: "text", text: 123 },
      ],
    };
    expect(AgentDisplayHelpers.serializeToolResultText(result)).toBe("valid");
  });

  it("returns first text block when text field is missing in some blocks", () => {
    const result = {
      content: [{ type: "text" }, { type: "text", text: "found" }],
    };
    expect(AgentDisplayHelpers.serializeToolResultText(result)).toBe("found");
  });

  it("serializes a plain object as formatted JSON", () => {
    const result = AgentDisplayHelpers.serializeToolResultText({ key: "value", num: 42 });
    expect(result).toContain('"key"');
    expect(result).toContain("value");
    expect(result).toContain('"num"');
    expect(result).toContain("42");
  });

  it("serializes an array as JSON", () => {
    const result = AgentDisplayHelpers.serializeToolResultText(["a", "b", "c"]);
    expect(result).toContain('"a"');
    expect(result).toContain('"b"');
  });

  it("serializes an Error object as JSON (own enumerable properties)", () => {
    const error = new Error("something broke");
    const result = AgentDisplayHelpers.serializeToolResultText(error);
    // Error has no enumerable own properties by default.
    expect(result).toBe("{}");
  });

  it("handles circular references by falling back to String()", () => {
    const obj: Record<string, unknown> = { name: "circle" };
    obj.self = obj;
    const result = AgentDisplayHelpers.serializeToolResultText(obj);
    expect(result).toBe("[object Object]");
  });

  it("handles content array with only non-text blocks (falls back to JSON)", () => {
    const result = {
      content: [{ type: "tool_use", id: "t1" }],
    };
    const text = AgentDisplayHelpers.serializeToolResultText(result);
    expect(text).toContain("tool_use");
    expect(text).toContain("t1");
  });

  it("handles empty content array (falls back to JSON)", () => {
    const result = { content: [] };
    const text = AgentDisplayHelpers.serializeToolResultText(result);
    expect(text).toContain('"content"');
    expect(text).toContain("[]");
  });

  it("returns string representation for boolean values", () => {
    expect(AgentDisplayHelpers.serializeToolResultText(true)).toBe("true");
    expect(AgentDisplayHelpers.serializeToolResultText(false)).toBe("false");
  });

  it("returns string representation for numeric values", () => {
    expect(AgentDisplayHelpers.serializeToolResultText(0)).toBe("0");
    expect(AgentDisplayHelpers.serializeToolResultText(42)).toBe("42");
  });

  it("handles a deeply nested object without circular refs (JSON)", () => {
    const nested = { level1: { level2: { level3: "deep" } } };
    const result = AgentDisplayHelpers.serializeToolResultText(nested);
    expect(result).toContain("deep");
    expect(result).toContain("level3");
  });

  it("handles content with mixed text and non-text blocks gracefully", () => {
    const result = {
      content: [
        { type: "text", text: "first" },
        { type: "image", source: { url: "https://example.com/img.png" } },
        { type: "text", text: "last" },
      ],
    };
    expect(AgentDisplayHelpers.serializeToolResultText(result)).toBe("first\nlast");
  });

  it("handles content array where block is null (skipped gracefully)", () => {
    const result = {
      content: [{ type: "text", text: "works" }, null],
    };
    expect(AgentDisplayHelpers.serializeToolResultText(result)).toBe("works");
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
