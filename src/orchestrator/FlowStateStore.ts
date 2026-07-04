import { logger } from "../logging";

/**
 * Mutable registry for flow-global state that persists across routine calls
 * within a single flow execution.
 *
 * Owned by {@link RoutineExecutor}, mutated in-place by step executors,
 * and merged into every new {@link FlowContext}. Follows the Registry
 * pattern used by {@link StepExecutorRegistry}, {@link WorktreeRegistry},
 * {@link ToolRegistry}, and {@link SpecRegistry}.
 */
export class FlowStateStore {
  private readonly store = new Map<string, string>();

  set(key: string, value: string): void {
    this.store.set(key, value);
    logger.debug("FlowStateStore.set", { key, value: value.slice(0, 80) });
  }

  get(key: string): string | undefined {
    return this.store.get(key);
  }

  entries(): IterableIterator<[string, string]> {
    return this.store.entries();
  }

  toObject(): Record<string, string> {
    return Object.fromEntries(this.store);
  }
}
