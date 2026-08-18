import { describe, expect, it } from "vitest";

import { cloneReadonlyArray, deepFreeze } from "./freeze";

describe("deepFreeze", () => {
  describe("on a non-empty Map", () => {
    it("recursively freezes keys and values", () => {
      const key = { id: 1 };
      const value = { tags: ["a", "b"] };
      const frozen = deepFreeze(new Map<{ id: number }, { tags: string[] }>([[key, value]]));

      const entries = [...frozen.entries()];
      expect(entries).toHaveLength(1);
      expect(Object.isFrozen(frozen)).toBe(true);
      expect(Object.isFrozen(entries[0][0])).toBe(true);
      expect(Object.isFrozen(entries[0][1])).toBe(true);
      expect(Object.isFrozen(entries[0][1].tags)).toBe(true);

      expect(() => {
        entries[0][0].id = 2;
      }).toThrow(TypeError);
      expect(() => {
        entries[0][1].tags.push("c");
      }).toThrow(TypeError);
    });

    it("blocks set, delete, and clear", () => {
      const frozen = deepFreeze(new Map<string, number>([["a", 1]]));

      expect(() => frozen.set("b", 2)).toThrow(TypeError);
      expect(() => frozen.delete("a")).toThrow(TypeError);
      expect(() => frozen.clear()).toThrow(TypeError);
    });
  });

  describe("on a nested object/array", () => {
    it("freezes nested structures so mutation throws", () => {
      const nested = {
        config: { max: 5 },
        tags: ["a", "b"],
      };
      const frozen = deepFreeze(nested);

      expect(Object.isFrozen(frozen)).toBe(true);
      expect(Object.isFrozen(frozen.config)).toBe(true);
      expect(Object.isFrozen(frozen.tags)).toBe(true);

      expect(() => {
        frozen.config.max = 10;
      }).toThrow(TypeError);
      expect(() => {
        frozen.tags.push("c");
      }).toThrow(TypeError);
    });
  });
});

describe("cloneReadonlyArray", () => {
  it("returns a distinct array whose mutation does not affect the source", () => {
    const source: readonly string[] = ["a", "b"];
    const clone = cloneReadonlyArray(source);

    expect(clone).toEqual(source);
    expect(clone).not.toBe(source);

    clone.push("c");
    expect(clone).toEqual(["a", "b", "c"]);
    expect(source).toEqual(["a", "b"]);
  });
});
