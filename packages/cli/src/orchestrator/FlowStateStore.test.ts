import { describe, expect, it } from "vitest";

import { FlowStateStore } from "./FlowStateStore";

describe("FlowStateStore", () => {
  it("starts empty", () => {
    const store = new FlowStateStore();
    expect([...store.entries()]).toEqual([]);
    expect(store.toObject()).toEqual({});
  });

  it("sets and reads values", () => {
    const store = new FlowStateStore();
    store.set("base", "main");
    store.set("workspace", "/tmp/ws");
    expect(store.get("base")).toBe("main");
    expect(store.get("workspace")).toBe("/tmp/ws");
    expect([...store.entries()]).toHaveLength(2);
  });

  it("allows overwriting an existing key (flow state changes across routines)", () => {
    const store = new FlowStateStore();
    store.set("base", "main");
    expect(() => store.set("base", "develop")).not.toThrow();
    expect(store.get("base")).toBe("develop");
    expect([...store.entries()]).toHaveLength(1);
  });

  it("returns undefined for unknown keys", () => {
    const store = new FlowStateStore();
    expect(store.get("missing")).toBeUndefined();
  });

  it("iterates entries in insertion order", () => {
    const store = new FlowStateStore();
    store.set("a", "1");
    store.set("b", "2");
    expect([...store.entries()]).toEqual([
      ["a", "1"],
      ["b", "2"],
    ]);
  });

  it("serializes to a plain object", () => {
    const store = new FlowStateStore();
    store.set("base", "main");
    store.set("pr", "42");
    expect(store.toObject()).toEqual({ base: "main", pr: "42" });
  });
});
