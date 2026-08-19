import { describe, expect, it } from "vitest";

import { Registry } from "./Registry";

class StringRegistry extends Registry<string> {}

describe("Registry", () => {
  describe("set", () => {
    it("stores an item by name", () => {
      const registry = new StringRegistry();
      registry.set("a", "alpha");
      expect(registry.get("a")).toBe("alpha");
    });

    it("throws when registering a duplicate name", () => {
      const registry = new StringRegistry();
      registry.set("a", "alpha");
      expect(() => registry.set("a", "beta")).toThrow("Item already registered: a");
    });
  });

  describe("get", () => {
    it("returns undefined for unknown names", () => {
      const registry = new StringRegistry();
      expect(registry.get("missing")).toBeUndefined();
    });

    it("returns registered item by name", () => {
      const registry = new StringRegistry();
      registry.set("foo", "Foo item");
      expect(registry.get("foo")).toBe("Foo item");
    });
  });

  describe("getAll", () => {
    it("returns empty array when no items registered", () => {
      const registry = new StringRegistry();
      expect(registry.getAll()).toEqual([]);
    });

    it("returns all registered items", () => {
      const registry = new StringRegistry();
      registry.set("a", "alpha");
      registry.set("b", "beta");
      expect(registry.getAll()).toEqual(["alpha", "beta"]);
    });

    it("returns a snapshot (mutations don't affect returned array)", () => {
      const registry = new StringRegistry();
      registry.set("a", "alpha");
      const all = registry.getAll();
      registry.set("b", "beta");
      expect(all).toHaveLength(1);
    });
  });

  describe("unregister", () => {
    it("returns true and removes the item", () => {
      const registry = new StringRegistry();
      registry.set("a", "alpha");
      expect(registry.unregister("a")).toBe(true);
      expect(registry.has("a")).toBe(false);
    });

    it("returns false for unknown names", () => {
      const registry = new StringRegistry();
      expect(registry.unregister("missing")).toBe(false);
    });

    it("second unregister returns false", () => {
      const registry = new StringRegistry();
      registry.set("foo", "Foo");
      registry.unregister("foo");
      expect(registry.unregister("foo")).toBe(false);
    });
  });

  describe("where", () => {
    it("filters items by predicate", () => {
      const registry = new StringRegistry();
      registry.set("a", "alpha");
      registry.set("b", "beta");
      registry.set("c", "gamma");
      const result = registry.where((item) => item.startsWith("a"));
      expect(result).toEqual(["alpha"]);
    });

    it("returns empty array when no items match", () => {
      const registry = new StringRegistry();
      registry.set("a", "alpha");
      expect(registry.where((item) => item === "beta")).toEqual([]);
    });
  });

  describe("has", () => {
    it("returns true for registered names", () => {
      const registry = new StringRegistry();
      registry.set("a", "alpha");
      expect(registry.has("a")).toBe(true);
    });

    it("returns false for unknown names", () => {
      const registry = new StringRegistry();
      expect(registry.has("missing")).toBe(false);
    });

    it("returns false after unregister", () => {
      const registry = new StringRegistry();
      registry.set("foo", "Foo");
      registry.unregister("foo");
      expect(registry.has("foo")).toBe(false);
    });
  });

  describe("size", () => {
    it("returns 0 for empty registry", () => {
      expect(new StringRegistry().size).toBe(0);
    });

    it("returns the count of registered items", () => {
      const registry = new StringRegistry();
      registry.set("a", "alpha");
      registry.set("b", "beta");
      expect(registry.size).toBe(2);
    });

    it("decrements on unregister", () => {
      const registry = new StringRegistry();
      registry.set("a", "alpha");
      registry.set("b", "beta");
      registry.unregister("a");
      expect(registry.size).toBe(1);
    });
  });
});
