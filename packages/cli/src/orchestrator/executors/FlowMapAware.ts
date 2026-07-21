import type { FlowDefinition } from "../FlowInstruction";

/**
 * Optional interface for step executors that need access to the shared
 * flow map for cross-flow routine reference resolution.
 *
 * Implemented by {@link RoutineRefStepExecutor}. The registry threads
 * the flow map via type narrowing rather than an optional method on the
 * abstract base class to avoid ISP violations.
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
