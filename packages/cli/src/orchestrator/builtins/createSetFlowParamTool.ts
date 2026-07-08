import type { AgentSupervisor } from "../../agents/supervisors/AgentSupervisor";
import type { FlowInstruction } from "../FlowInstruction";
import type { RoutineExecutor } from "../RoutineExecutor";
import { RoutineTool } from "../RoutineTool";

/**
 * Builds the `set_flow_param` routine — a builtin available in every flow.
 *
 * Writes a key/value pair into the {@link FlowStateStore} via a
 * {@link ../executors/SessionStepExecutor} instruction. Values persist
 * across all routine calls within a flow execution.
 *
 * Defined here (not in flow.json) because it is flow-independent
 * infrastructure — every flow needs it, no flow author should declare it.
 */
export function createSetFlowParamTool(
  flowName: string,
  executor: RoutineExecutor,
  supervisor: AgentSupervisor,
): RoutineTool {
  const definition = {
    params: [
      { name: "key", description: "Session key to set" },
      { name: "value", description: "Value to store" },
    ],
    steps: [
      {
        type: "session",
        id: "set",
        key: "{{key}}",
        value: "{{value}}",
      } as unknown as FlowInstruction,
    ],
  };

  return new RoutineTool(flowName, "set_flow_param", executor, definition, supervisor);
}
