import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { logger } from "../logging";
import type { RoutineDefinition } from "./FlowInstruction";
import { RoutineExecutor } from "./RoutineExecutor";

/**
 * Tool adapter that wraps a single routine as a pi tool so the
 * orchestrator LLM can invoke it by name.
 *
 * Each routine gets its own {@link RoutineTool} instance, registered
 * at flow-load time.
 *
 * Implements {@link ToolDefinition} directly rather than extending
 * the abstract {@link Tool} class, because the Tool base class
 * constrains TParams to extend TSchema, while we use a flat
 * Record<string, string> that is the runtime shape but not a
 * TypeBox schema.
 */
export class RoutineTool implements ToolDefinition<
  typeof RoutineTool.parameters,
  { routine: string; passed: boolean; summary: string }
> {
  readonly name: string;
  readonly label: string;
  readonly description: string;

  /** Parameters schema for the tool — a flat record of string→string. */
  static readonly parameters = Type.Record(Type.String(), Type.String());

  readonly parameters = RoutineTool.parameters;

  private readonly routineName: string;

  constructor(
    flowName: string,
    routineName: string,
    private readonly executor: RoutineExecutor,
    private readonly routineDef: RoutineDefinition,
  ) {
    this.routineName = routineName;
    this.name = routineName;
    this.label = `Routine: ${flowName}/${routineName}`;
    this.description =
      routineDef.params.length === 0
        ? `Run the "${routineName}" routine from the "${flowName}" flow.`
        : `Run the "${routineName}" routine from the "${flowName}" flow. ` +
          `Parameters: ${routineDef.params.map((p) => p.name).join(", ")}.`;
  }

  async execute(
    _toolCallId: string,
    params: Record<string, string>,
    _signal: AbortSignal | undefined,
    _onUpdate:
      | AgentToolUpdateCallback<{ routine: string; passed: boolean; summary: string }>
      | undefined,
    _ctx: ExtensionContext,
  ): Promise<AgentToolResult<{ routine: string; passed: boolean; summary: string }>> {
    logger.info("RoutineTool invoked", {
      routine: this.routineName,
      params: Object.keys(params),
    });

    const task = params["task"] ?? params["_task"] ?? "";
    const routineParams: Record<string, string> = {};
    for (const param of this.routineDef.params) {
      if (param.name in params) {
        routineParams[param.name] = params[param.name];
      }
    }

    const result = await this.executor.run(this.routineName, routineParams, task);

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      details: { routine: result.routine, passed: result.passed, summary: result.summary },
    };
  }
}
