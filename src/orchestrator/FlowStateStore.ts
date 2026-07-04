import { Registry } from "../registry";

/** Named alias for flow-level parameter/state maps used across the orchestrator. */
export type FlowParams = Record<string, string>;

/**
 * Mutable registry for flow-global state that persists across routine calls
 * within a single flow execution.
 *
 * Owned by {@link RoutineExecutor}, mutated in-place by step executors,
 * and merged into every new {@link FlowContext}. Extends {@link Registry}
 * for consistency with {@link StepExecutorRegistry}, {@link WorktreeRegistry},
 * {@link ToolRegistry}, and {@link SpecRegistry}.
 *
 * Unlike other registries, `set()` allows overwrites — flow state values
 * are expected to change across routine calls (e.g. `base` is set once
 * in Phase 0, then never changed).
 */
export class FlowStateStore extends Registry<string> {
  override set(key: string, value: string): void {
    this.items.set(key, value);
  }

  entries(): IterableIterator<[string, string]> {
    return this.items.entries();
  }

  toObject(): FlowParams {
    return Object.fromEntries(this.items);
  }
}
