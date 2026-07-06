import type { EventBus } from "@earendil-works/pi-coding-agent";

import type { FlowDefinition } from "./FlowInstruction";
import type { StepExecutorRegistry } from "./StepExecutorRegistry";

/**
 * Holds the runtime services that step executors need for cross-flow
 * routine execution.
 *
 * Passed via constructor injection to step executors that require it
 * (e.g. {@link RoutineRefStepExecutor}). This keeps the executor
 * signatures unchanged while giving access to the broader system.
 *
 * The `flows` map is populated by {@link FlowRegistrar} during
 * `registerAll()` — it is empty at construction time and filled
 * before any step executor reads from it.
 */
export class RuntimeCapabilities {
  constructor(
    /** Event bus for streaming progress events. */
    public readonly eventBus: EventBus,
    /** Registry of step executors for dispatching child instructions. */
    public readonly stepExecutorRegistry: StepExecutorRegistry,
    /**
     * Map of loaded flow definitions keyed by flow command name.
     *
     * Used by {@link RoutineRefStepExecutor} to look up target flows
     * and their routines at runtime. Populated during flow registration
     * (before any executor calls `execute()`).
     */
    public readonly flows: Map<string, FlowDefinition>,
  ) {}
}
