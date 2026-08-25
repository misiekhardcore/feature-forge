import { describe, expect, it } from "vitest";

import { walkResultPath } from "./resultPath";

function map(entries: Array<[string, unknown]>): ReadonlyMap<string, unknown> {
  return new Map(entries);
}

describe("walkResultPath", () => {
  it("returns the whole stored result for empty segments", () => {
    const results = map([["step", { ok: true }]]);
    expect(walkResultPath(results, "step", [])).toEqual({ ok: true, value: { ok: true } });
  });

  it("returns no-result for a missing step id", () => {
    const results = map([["other", 1]]);
    expect(walkResultPath(results, "missing", ["a"])).toEqual({
      ok: false,
      failure: { reason: "no-result" },
    });
  });

  it("returns no-result when the stored value itself is undefined", () => {
    const results = map([["step", undefined]]);
    expect(walkResultPath(results, "step", [])).toEqual({
      ok: false,
      failure: { reason: "no-result" },
    });
  });

  it("walks nested object paths", () => {
    const results = map([["step", { body: { data: { items: [1, 2, 3] } } }]]);
    expect(walkResultPath(results, "step", ["body", "data", "items"])).toEqual({
      ok: true,
      value: [1, 2, 3],
    });
  });

  it("resolves a single segment", () => {
    const results = map([["step", { base: "main" }]]);
    expect(walkResultPath(results, "step", ["base"])).toEqual({
      ok: true,
      value: "main",
    });
  });

  it("resolves scalar leaf values including null", () => {
    const results = map([["step", { value: null }]]);
    expect(walkResultPath(results, "step", ["value"])).toEqual({ ok: true, value: null });
  });

  it("resolves a found number value", () => {
    const results = map([["step", { score: 3 }]]);
    expect(walkResultPath(results, "step", ["score"])).toEqual({ ok: true, value: 3 });
  });

  it("resolves falsy leaf values (0, false, empty string) as found values", () => {
    const results = map([["step", { zero: 0, no: false, empty: "" }]]);
    expect(walkResultPath(results, "step", ["zero"])).toEqual({ ok: true, value: 0 });
    expect(walkResultPath(results, "step", ["no"])).toEqual({ ok: true, value: false });
    expect(walkResultPath(results, "step", ["empty"])).toEqual({ ok: true, value: "" });
  });

  it("returns a primitive stored result as-is for empty segments", () => {
    const results = map([["step", 42]]);
    expect(walkResultPath(results, "step", [])).toEqual({ ok: true, value: 42 });
  });

  it("fails with missing-key when a key is absent", () => {
    const results = map([["step", { body: {} }]]);
    expect(walkResultPath(results, "step", ["body", "data"])).toEqual({
      ok: false,
      failure: { reason: "missing-key", at: 1, key: "data" },
    });
  });

  it("fails with missing-key when a key exists but its value is undefined", () => {
    const results = map([["step", { body: { data: undefined } }]]);
    expect(walkResultPath(results, "step", ["body", "data"])).toEqual({
      ok: false,
      failure: { reason: "missing-key", at: 1, key: "data" },
    });
  });

  it("fails with not-traversable when an intermediate value is a primitive", () => {
    const results = map([["step", { body: 42 }]]);
    expect(walkResultPath(results, "step", ["body", "data"])).toEqual({
      ok: false,
      failure: { reason: "not-traversable", at: 1, key: "data", current: 42 },
    });
  });

  it("fails with not-traversable when an intermediate value is null", () => {
    const results = map([["step", { body: null }]]);
    expect(walkResultPath(results, "step", ["body", "data"])).toEqual({
      ok: false,
      failure: { reason: "not-traversable", at: 1, key: "data", current: null },
    });
  });

  it("fails with not-traversable when an intermediate value is a string", () => {
    const results = map([["step", { body: "text" }]]);
    expect(walkResultPath(results, "step", ["body", "data"])).toEqual({
      ok: false,
      failure: { reason: "not-traversable", at: 1, key: "data", current: "text" },
    });
  });

  it("fails with not-traversable when the stored value is a primitive", () => {
    const results = map([["step", "scalar"]]);
    expect(walkResultPath(results, "step", ["a"])).toEqual({
      ok: false,
      failure: { reason: "not-traversable", at: 0, key: "a", current: "scalar" },
    });
  });

  it("reports the correct segment index for deep failures", () => {
    const results = map([["step", { a: { b: { c: { d: 1 } } } }]]);
    expect(walkResultPath(results, "step", ["a", "b", "missing", "d"])).toEqual({
      ok: false,
      failure: { reason: "missing-key", at: 2, key: "missing" },
    });
  });

  it("walks arrays as index-keyed objects", () => {
    const results = map([["step", { items: [{ name: "first" }] }]]);
    expect(walkResultPath(results, "step", ["items", "0", "name"])).toEqual({
      ok: true,
      value: "first",
    });
  });

  it("fails with missing-key for an out-of-bounds array index", () => {
    const results = map([["step", { items: [1, 2] }]]);
    expect(walkResultPath(results, "step", ["items", "5"])).toEqual({
      ok: false,
      failure: { reason: "missing-key", at: 1, key: "5" },
    });
  });

  it("treats non-enumerable own keys (array length) as missing", () => {
    const results = map([["step", { items: [1, 2] }]]);
    expect(walkResultPath(results, "step", ["items", "length"])).toEqual({
      ok: false,
      failure: { reason: "missing-key", at: 1, key: "length" },
    });
  });

  it("treats own accessor properties as missing without invoking the getter", () => {
    let invoked = 0;
    const obj: Record<string, unknown> = {};
    Object.defineProperty(obj, "computed", {
      enumerable: true,
      get() {
        invoked++;
        throw new Error("getter must never be invoked");
      },
    });
    const results = map([["step", obj]]);
    expect(walkResultPath(results, "step", ["computed"])).toEqual({
      ok: false,
      failure: { reason: "missing-key", at: 0, key: "computed" },
    });
    expect(invoked).toBe(0);
  });

  it("treats prototype-chain keys as missing", () => {
    const results = map([["step", { items: [] }]]);
    expect(walkResultPath(results, "step", ["constructor"])).toEqual({
      ok: false,
      failure: { reason: "missing-key", at: 0, key: "constructor" },
    });
    expect(walkResultPath(results, "step", ["__proto__", "constructor"])).toEqual({
      ok: false,
      failure: { reason: "missing-key", at: 0, key: "__proto__" },
    });
  });
});
