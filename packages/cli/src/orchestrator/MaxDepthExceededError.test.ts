import { describe, expect, it } from "vitest";

import { MaxDepthExceededError } from "./MaxDepthExceededError";

describe("MaxDepthExceededError", () => {
  it("creates an error with the correct name", () => {
    const err = new MaxDepthExceededError(10);
    expect(err.name).toBe("MaxDepthExceededError");
  });

  it("includes the depth in the message", () => {
    const err = new MaxDepthExceededError(10);
    expect(err.message).toContain("10");
    expect(err.message).toContain(String(MaxDepthExceededError.MAX_NESTING_DEPTH));
  });

  it("has a static MAX_NESTING_DEPTH constant", () => {
    expect(MaxDepthExceededError.MAX_NESTING_DEPTH).toBe(10);
  });

  it("is an instance of Error and MaxDepthExceededError", () => {
    const err = new MaxDepthExceededError(5);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(MaxDepthExceededError);
  });

  it("passes cause via ErrorOptions", () => {
    const cause = new Error("root cause");
    const err = new MaxDepthExceededError(7, { cause });
    expect(err.cause).toBe(cause);
  });

  it("has a stack trace", () => {
    const err = new MaxDepthExceededError(3);
    expect(err.stack).toBeDefined();
    expect(err.stack).toContain("MaxDepthExceededError");
  });
});
