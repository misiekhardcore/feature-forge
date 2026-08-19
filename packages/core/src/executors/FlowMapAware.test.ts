import { describe, expect, it } from "vitest";

import { isFlowMapAware } from "./FlowMapAware";

describe("isFlowMapAware", () => {
  it("returns false for null", () => {
    expect(isFlowMapAware(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isFlowMapAware(undefined)).toBe(false);
  });

  it("returns false for plain object without setFlowMap", () => {
    expect(isFlowMapAware({})).toBe(false);
  });

  it("returns false for object with non-function setFlowMap", () => {
    expect(isFlowMapAware({ setFlowMap: "not a function" })).toBe(false);
  });

  it("returns false for number", () => {
    expect(isFlowMapAware(123)).toBe(false);
  });

  it("returns false for string", () => {
    expect(isFlowMapAware("string")).toBe(false);
  });

  it("returns false for boolean", () => {
    expect(isFlowMapAware(true)).toBe(false);
  });

  it("returns false for array", () => {
    expect(isFlowMapAware([])).toBe(false);
  });

  it("returns true for object with setFlowMap function", () => {
    const executor = { setFlowMap: () => {} };
    expect(isFlowMapAware(executor)).toBe(true);
  });

  it("returns true for object with setFlowMap and other properties", () => {
    const executor = {
      setFlowMap: () => {},
      execute: () => Promise.resolve({}),
      type: "routine",
    };
    expect(isFlowMapAware(executor)).toBe(true);
  });
});
