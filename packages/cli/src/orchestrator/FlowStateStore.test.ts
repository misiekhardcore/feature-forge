import { describe, expect, it } from "vitest";

import { FlowStateStore } from "./FlowStateStore";

describe("FlowStateStore", () => {
  it("starts empty", () => {
    const store = new FlowStateStore();
    expect(store.size).toBe(0);
    expect(store.toObject()).toEqual({});
    expect([...store.entries()]).toEqual([]);
  });

  it("sets and reads values", () => {
    const store = new FlowStateStore();
    store.set("base", "main");
    store.set("workspace", "/tmp/ws");
    expect(store.get("base")).toBe("main");
    expect(store.get("workspace")).toBe("/tmp/ws");
    expect(store.has("base")).toBe(true);
    expect(store.size).toBe(2);
  });

  it("allows overwriting an existing key (flow state changes across routines)", () => {
    const store = new FlowStateStore();
    store.set("base", "main");
    expect(() => store.set("base", "develop")).not.toThrow();
    expect(store.get("base")).toBe("develop");
    expect(store.size).toBe(1);
  });

  it("returns undefined for unknown keys", () => {
    const store = new FlowStateStore();
    expect(store.get("missing")).toBeUndefined();
    expect(store.has("missing")).toBe(false);
  });

  it("unregisters keys", () => {
    const store = new FlowStateStore();
    store.set("base", "main");
    expect(store.unregister("base")).toBe(true);
    expect(store.unregister("base")).toBe(false);
    expect(store.get("base")).toBeUndefined();
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

  it("supports Registry collection queries", () => {
    const store = new FlowStateStore();
    store.set("base", "main");
    store.set("workspace", "/tmp/ws");
    expect(store.getAll()).toEqual(["main", "/tmp/ws"]);
    expect(store.where((value) => value.startsWith("/"))).toEqual(["/tmp/ws"]);
  });
});
