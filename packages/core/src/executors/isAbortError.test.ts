import { describe, expect, it } from "vitest";

import { isAbortError } from "./isAbortError";

describe("isAbortError", () => {
  it("returns true for DOMException with name AbortError", () => {
    const error = new DOMException("The operation was aborted", "AbortError");
    expect(isAbortError(error)).toBe(true);
  });

  it("returns false for DOMException with a different name", () => {
    const error = new DOMException("Not found", "NotFoundError");
    expect(isAbortError(error)).toBe(false);
  });

  it("returns false for a regular Error", () => {
    expect(isAbortError(new Error("something broke"))).toBe(false);
  });

  it("returns false for a string", () => {
    expect(isAbortError("abort error")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isAbortError(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isAbortError(undefined)).toBe(false);
  });

  it("returns false for a plain object", () => {
    expect(isAbortError({ name: "AbortError" })).toBe(false);
  });
});
