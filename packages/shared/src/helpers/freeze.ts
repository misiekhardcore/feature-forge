/**
 * Recursively freeze an object, array, or Map (including nested values).
 *
 * `Object.freeze` is shallow — callers could otherwise mutate nested
 * structures of the frozen defaults (e.g. `worktreeSymlinks.push(...)`
 * or `display.maxAgentEvents = 1`) and corrupt the process-wide defaults.
 *
 * Maps need extra care: `Object.freeze(map)` does NOT block the Map
 * mutators `set`/`delete`/`clear` (they operate on internal slots), so
 * throwing stubs are installed before freezing.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  if (value instanceof Map) {
    // Object.freeze alone does not block Map mutators — install throwing
    // stubs BEFORE freezing (defineProperties on a frozen object throws),
    // then recurse into keys and values. Iteration is unaffected by the
    // stubs, so the recursion below still sees every entry.
    Object.defineProperties(value, {
      set: { value: throwFrozenMapMutation("set") },
      delete: { value: throwFrozenMapMutation("delete") },
      clear: { value: throwFrozenMapMutation("clear") },
    });
    Object.freeze(value);
    for (const [key, entry] of value) {
      deepFreeze(key);
      deepFreeze(entry);
    }
    return value;
  }
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

function throwFrozenMapMutation(method: "set" | "delete" | "clear"): () => never {
  return () => {
    throw new TypeError(`Cannot mutate a frozen Map via ${method}()`);
  };
}

/**
 * Shallow-clone a readonly array into a fresh mutable copy.
 */
export function cloneReadonlyArray<T>(value: readonly T[]): T[] {
  return [...value];
}
