import { InMemoryAgentSupervisor, SpecManager } from "../agents";
import { WorkspaceProviderRegistry, WorktreeRegistry } from "../workspace";
import {
  AgentStepExecutor,
  CleanupStepExecutor,
  GitStepExecutor,
  LoopStepExecutor,
  ParallelStepExecutor,
  RoutineRefStepExecutor,
  SessionStepExecutor,
  ShellStepExecutor,
  WorkspaceStepExecutor,
} from "./executors";
import { StepExecutorRegistry } from "./StepExecutorRegistry";

/**
 * Creates and populates a {@link StepExecutorRegistry} with all built-in
 * step executors.
 *
 * Dependency injection wiring lives here — factory closures capture the
 * required dependencies so the registry itself stays dependency-free.
 *
 * Leaf executors are registered first so container executors
 * (parallel, loop) can use the populated registry for child dispatch
 * at execution time.
 */
export function createStepExecutorRegistry(
  workspaceProviderRegistry: WorkspaceProviderRegistry,
  supervisor: InMemoryAgentSupervisor,
  specManager: SpecManager,
  worktreeRegistry: WorktreeRegistry,
): StepExecutorRegistry {
  const registry = new StepExecutorRegistry();

  // Leaf executors
  registry.register(() => new WorkspaceStepExecutor(workspaceProviderRegistry, worktreeRegistry));
  registry.register(() => new AgentStepExecutor(supervisor, specManager));
  registry.register(() => new CleanupStepExecutor(workspaceProviderRegistry, worktreeRegistry));
  registry.register(() => new GitStepExecutor());
  registry.register(() => new ShellStepExecutor());
  registry.register(() => new SessionStepExecutor());
  registry.register(() => new RoutineRefStepExecutor());

  // Container executors — registered after leaves so they can use the
  // populated registry for child dispatch.
  registry.register(() => new ParallelStepExecutor());
  registry.register(() => new LoopStepExecutor());

  return registry;
}
