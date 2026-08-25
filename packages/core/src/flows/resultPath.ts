/**
 * Result path walking for flow step outputs.
 *
 * A result path is a dot-separated path into a step's stored result
 * (e.g. `body.data.items[0]` flattened to `["body", "data", "items", "0"]` -
 * arrays are walked as index-keyed objects). This module resolves such paths
 * against a per-step result map.
 */

export type ResultPathFailure =
  | { reason: "no-result" }
  | { reason: "not-traversable"; at: number; key: string; current: unknown }
  | { reason: "missing-key"; at: number; key: string };

export type ResultPathWalk =
  | { ok: true; value: unknown }
  | { ok: false; failure: ResultPathFailure };

/**
 * Walks `segments` into the stored result for `id`.
 *
 * - Missing step id (or a stored value that is `undefined`) yields
 *   `no-result` - callers cannot distinguish the two, by design.
 * - A `null`, `undefined` or non-object intermediate value yields
 *   `not-traversable` (with the offending `current` value attached).
 * - An absent key yields `missing-key`. Only own enumerable data keys are
 *   considered: non-enumerable own keys (e.g. array `length`), accessor
 *   properties, and own enumerable data keys whose value is `undefined` are
 *   all treated as absent, and inherited prototype-chain keys (e.g.
 *   `constructor`, `__proto__`) never resolve. Getters are never invoked, so
 *   the never-throws guarantee holds literally.
 * - `at` is the 0-based index into `segments`.
 * - Empty `segments` returns the whole stored result.
 *
 * Never throws: every failure mode is reported structurally via the
 * `ResultPathWalk` union. How a failure is rendered (blank string, throw,
 * `undefined`) is the caller's policy, not this module's.
 */
export function walkResultPath(
  results: ReadonlyMap<string, unknown>,
  id: string,
  segments: string[],
): ResultPathWalk {
  let current: unknown = results.get(id);
  if (current === undefined) {
    return { ok: false, failure: { reason: "no-result" } };
  }
  for (let i = 0; i < segments.length; i++) {
    if (current === null || current === undefined || typeof current !== "object") {
      return {
        ok: false,
        failure: { reason: "not-traversable", at: i, key: segments[i], current },
      };
    }
    const key = segments[i];
    const desc = Object.getOwnPropertyDescriptor(current, key);
    if (!desc || !desc.enumerable || desc.value === undefined) {
      return { ok: false, failure: { reason: "missing-key", at: i, key } };
    }
    current = desc.value;
  }
  return { ok: true, value: current };
}
