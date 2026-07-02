import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TObject, TProperties } from "typebox";
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
 * The tool's parameter schema is built dynamically from the routine's
 * declared `params` array so the LLM receives accurate parameter hints
 * with names and descriptions.
 *
 * Implements {@link ToolDefinition} directly rather than extending
 * the abstract {@link Tool} class, because the Tool base class
 * constrains TParams to extend TSchema, while we build a dynamic
 * schema that varies per routine.
 */
export class RoutineTool implements ToolDefinition<
  TObject<TProperties>,
  { routine: string; passed: boolean; summary: string }
> {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: TObject<TProperties>;

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
    this.description = this.buildDescription(routineName, routineDef);
    this.parameters = RoutineTool.buildParamsSchema(routineDef);
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

    const prompt = params["prompt"] ?? params["_prompt"] ?? "";
    const routineParams: Record<string, string> = {};
    for (const param of this.routineDef.params) {
      if (param.name in params) {
        routineParams[param.name] = params[param.name];
      }
    }

    const result = await this.executor.run(this.routineName, routineParams, prompt);

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      details: { routine: result.routine, passed: result.passed, summary: result.summary },
    };
  }

  // ── Static helpers ────────────────────────────────────────

  private static buildParamsSchema(routineDef: RoutineDefinition): TObject<TProperties> {
    const properties: Record<string, ReturnType<typeof Type.String>> = {};
    for (const param of routineDef.params) {
      properties[param.name] = Type.String({
        description: param.description,
      });
    }
    return Type.Object(properties) as unknown as TObject<TProperties>;
  }

  private buildDescription(routineName: string, routineDef: RoutineDefinition): string {
    if (routineDef.params.length === 0) {
      return `Run the "${routineName}" routine.`;
    }
    const paramList = routineDef.params.map((p) => p.name).join(", ");
    return `Run the "${routineName}" routine with params: ${paramList}.`;
  }
}
