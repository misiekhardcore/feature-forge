/**
 * Immutable key-value store that persists across routine calls within a
 * single flow execution.
 *
 * Owned by {@link RoutineExecutor} — seeded from flow-level param defaults
 * at startup, updated by `session` instruction steps during routine runs,
 * and merged into every new {@link FlowContext}.
 */
export class FlowSession {
  constructor(readonly values: ReadonlyMap<string, string> = new Map()) {}

  set(key: string, value: string): FlowSession {
    const next = new Map(this.values);
    next.set(key, value);
    return new FlowSession(next);
  }

  entries(): IterableIterator<[string, string]> {
    return this.values.entries();
  }
}
