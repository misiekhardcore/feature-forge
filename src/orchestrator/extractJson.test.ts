import { describe, expect, it } from "vitest";

import { extractJson } from "./extractJson";

describe("extractJson", () => {
  it("extracts a JSON block from a markdown code fence", () => {
    const raw = 'Some text\n```json\n{"kind":"build","passed":true,"summary":"ok"}\n```\nMore text';
    const result = extractJson(raw);
    expect(result).toEqual({ kind: "build", passed: true, summary: "ok" });
  });

  it("returns undefined when no json code fence is present", () => {
    const raw = "No json block here";
    const result = extractJson(raw);
    expect(result).toBeUndefined();
  });

  it("returns undefined for empty json block", () => {
    const raw = "```json\n\n```";
    const result = extractJson(raw);
    expect(result).toBeUndefined();
  });

  it("returns undefined for invalid JSON", () => {
    const raw = "```json\n{invalid json}\n```";
    const result = extractJson(raw);
    expect(result).toBeUndefined();
  });

  it("extracts a review findings JSON block", () => {
    const raw =
      '```json\n{"kind":"review","passed":false,"findings":{"critical":["bug"],"warnings":[],"info":[]}}\n```';
    const result = extractJson(raw);
    expect(result).toEqual({
      kind: "review",
      passed: false,
      findings: { critical: ["bug"], warnings: [], info: [] },
    });
  });

  it("handles trailing whitespace in the fence", () => {
    const raw = '```json   \n{"kind":"build","passed":true,"summary":"ok"}\n```';
    const result = extractJson(raw);
    expect(result).toEqual({ kind: "build", passed: true, summary: "ok" });
  });
});
