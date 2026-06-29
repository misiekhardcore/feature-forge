import { StepExecutor } from "./StepExecutor";

/**
 * Open registry mapping instruction types to {@link StepExecutor} instances.
 *
 * Executors are registered via factory closures — the registry owns
 * instantiation and calls each factory once at registration time.
 *
 * Built-in executors register at init. Extension authors can register custom
 * executors for new instruction types without modifying existing code.
 *
 * A composition mechanism — resolves implementations, owns no business logic.
 */
export class StepExecutorRegistry {
  private readonly executors = new Map<string, StepExecutor>();

  /**
   * Register a step executor from a factory closure.
   *
   * The factory is called immediately and the resulting executor is stored.
   * This matches the constructor-accepting pattern used by
   * {@link CommandRegistry} and {@link ToolRegistry}.
   */
  register(factory: () => StepExecutor): this {
    const executor = factory();
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
