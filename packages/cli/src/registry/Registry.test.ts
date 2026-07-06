import { Registry } from "@feature-forge/shared";
import { beforeEach, describe, expect, it } from "vitest";

class TestItem {
  constructor(
    public readonly name: string,
    public readonly description: string,
    public readonly group?: string,
  ) {}
}

class TestRegistry extends Registry<TestItem> {
  register(item: TestItem): void {
    if (this.items.has(item.name)) {
      throw new Error(`Already registered: ${item.name}`);
    }
    this.items.set(item.name, item);
  }
}

describe("Registry", () => {
  let registry: TestRegistry;

  beforeEach(() => {
    registry = new TestRegistry();
  });

  describe("get", () => {
    it("returns undefined for unregistered item", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });

    it("returns registered item by name", () => {
      const item = new TestItem("foo", "Foo item");
      registry.register(item);
      expect(registry.get("foo")).toBe(item);
    });
  });

  describe("getAll", () => {
    it("returns empty array when no items registered", () => {
      expect(registry.getAll()).toEqual([]);
    });

    it("returns all registered items", () => {
      const a = new TestItem("a", "A");
      const b = new TestItem("b", "B");
      registry.register(a);
      registry.register(b);
      expect(registry.getAll()).toEqual([a, b]);
    });

    it("returns a snapshot (mutations don't affect returned array)", () => {
      const a = new TestItem("a", "A");
      registry.register(a);
      const all = registry.getAll();
      registry.register(new TestItem("b", "B"));
      expect(all).toHaveLength(1);
    });
  });

  describe("unregister", () => {
    it("returns false for unregistered name", () => {
      expect(registry.unregister("nonexistent")).toBe(false);
    });

    it("removes item and returns true", () => {
      registry.register(new TestItem("foo", "Foo"));
      expect(registry.unregister("foo")).toBe(true);
      expect(registry.get("foo")).toBeUndefined();
    });

    it("second unregister returns false", () => {
      registry.register(new TestItem("foo", "Foo"));
      registry.unregister("foo");
      expect(registry.unregister("foo")).toBe(false);
    });
  });

  describe("where", () => {
    it("returns empty array when predicate matches nothing", () => {
      registry.register(new TestItem("a", "A"));
      expect(registry.where(() => false)).toEqual([]);
    });

    it("filters items by predicate", () => {
      const a = new TestItem("a", "A", "group1");
      const b = new TestItem("b", "B", "group1");
      const c = new TestItem("c", "C", "group2");
      registry.register(a);
      registry.register(b);
      registry.register(c);
      expect(registry.where((item) => item.group === "group1")).toEqual([a, b]);
    });
  });

  describe("has", () => {
    it("returns false for unregistered name", () => {
      expect(registry.has("foo")).toBe(false);
    });

    it("returns true for registered name", () => {
      registry.register(new TestItem("foo", "Foo"));
      expect(registry.has("foo")).toBe(true);
    });

    it("returns false after unregister", () => {
      registry.register(new TestItem("foo", "Foo"));
      registry.unregister("foo");
      expect(registry.has("foo")).toBe(false);
    });
  });

  describe("size", () => {
    it("starts at 0", () => {
      expect(registry.size).toBe(0);
    });

    it("increments on register", () => {
      registry.register(new TestItem("a", "A"));
      registry.register(new TestItem("b", "B"));
      expect(registry.size).toBe(2);
    });

    it("decrements on unregister", () => {
      registry.register(new TestItem("a", "A"));
      registry.register(new TestItem("b", "B"));
      registry.unregister("a");
      expect(registry.size).toBe(1);
    });
  });
});
