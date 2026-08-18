/** Named alias for flow-level parameter/state maps used across the orchestrator. */
export type FlowParams = Record<string, string>;

/**
 * Mutable store for flow-global state that persists across routine calls
 * within a single flow execution.
 *
 * Owned by {@link RoutineExecutor}, mutated in-place by step executors,
 * and merged into every new {@link FlowContext}.
 *
 * Standalone Map-backed class - deliberately NOT a {@link Registry} subclass:
 * unlike registries, `set()` allows overwrites (flow state values change
 * across routine calls), and registry queries (`where`, `getAll`) make no
 * sense for state.
 */
export class FlowStateStore {
  private readonly items = new Map<string, string>();

  get(key: string): string | undefined {
    return this.items.get(key);
  }

  set(key: string, value: string): void {
    this.items.set(key, value);
  }

  entries(): IterableIterator<[string, string]> {
    return this.items.entries();
  }

  toObject(): FlowParams {
    return Object.fromEntries(this.items);
  }
}
