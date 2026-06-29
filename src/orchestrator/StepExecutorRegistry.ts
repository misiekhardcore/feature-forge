import type { StepExecutor } from "./StepExecutor";

/**
 * Extensible registry of step executors.
 *
 * Built-in executors (workspace, agent, parallel, loop, cleanup, shell)
 * register at init time. Extensions can register custom executors for
 * new step types before flows are loaded.
 */
export class StepExecutorRegistry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly executors = new Map<string, StepExecutor<any>>();

  /** Register a step executor for a given instruction type. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register(executor: StepExecutor<any>): void {
    if (this.executors.has(executor.type)) {
      throw new Error(`Step executor already registered for type: ${executor.type}`);
    }
    this.executors.set(executor.type, executor);
  }

  /**
   * Register multiple executors at once.
   *
   * Convenience for init-time registration of built-in executors.
   * Returns the registry for chaining.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerAll(...executors: StepExecutor<any>[]): this {
    for (const executor of executors) {
      this.register(executor);
    }
    return this;
  }

  /** Find an executor by instruction type. Returns undefined if not found. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  find(type: string): StepExecutor<any> | undefined {
    return this.executors.get(type);
  }

  /** Check whether an executor is registered for the given type. */
  has(type: string): boolean {
    return this.executors.has(type);
  }
}
