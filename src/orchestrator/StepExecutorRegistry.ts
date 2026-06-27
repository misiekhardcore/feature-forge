import { StepExecutor } from "./StepExecutor";

/**
 * Open registry mapping instruction types to {@link StepExecutor} instances.
 *
 * Built-in executors register at init. Extension authors can register custom
 * executors for new instruction types without modifying existing code.
 *
 * A composition mechanism — resolves implementations, owns no business logic.
 */
export class StepExecutorRegistry {
  private readonly executors = new Map<string, StepExecutor>();

  register(executor: StepExecutor): this {
    if (this.executors.has(executor.type)) {
      throw new Error(`Step executor already registered for type: ${executor.type}`);
    }
    this.executors.set(executor.type, executor);
    return this;
  }

  get(type: string): StepExecutor | undefined {
    return this.executors.get(type);
  }

  has(type: string): boolean {
    return this.executors.has(type);
  }

  types(): ReadonlySet<string> {
    return new Set(this.executors.keys());
  }
}
