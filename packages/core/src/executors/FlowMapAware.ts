import type { FlowDefinition } from "../flows/FlowInstruction";

/**
 * Interface for step executors that need access to the shared flow map
 * for cross-flow routine reference resolution.
 *
 * Implemented by {@link RoutineRefStepExecutor}. The registry threads
 * the flow map via the {@link isFlowMapAware} type guard rather than an
 * abstract base class — TypeScript single inheritance prevents
 * {@link RoutineRefStepExecutor} from extending both {@link StepExecutor}
 * and a hypothetical FlowMapAware base class.
 *
 * This is an intentional ISP-preserving pattern: only the single executor
 * that needs the flow map carries this interface, keeping other executors
 * free of unused API surface.
 */
export interface FlowMapAware {
  setFlowMap(flowMap: Map<string, FlowDefinition>): void;
}

/**
 * Type guard: returns true if the value conforms to {@link FlowMapAware}.
 */
export function isFlowMapAware(value: unknown): value is FlowMapAware {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as FlowMapAware).setFlowMap === "function"
  );
}
