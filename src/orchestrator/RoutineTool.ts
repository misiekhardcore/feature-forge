import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { type TObject, type TProperties, type TSchema, Type } from "typebox";

import type { FlowDefinition } from "./FlowInstruction";
import { RoutineExecutor } from "./RoutineExecutor";
import type { RoutineResult } from "./RoutineResult";

/**
 * Pi ToolDefinition implementation that adapts {@link RoutineExecutor.run}
 * to the tool interface.
 *
 * One instance per routine, registered via
 * {@link ToolRegistry.registerInstance}.
 *
 * The tool's parameter schema is built dynamically from the routine's
 * declared `params` array so the LLM receives accurate parameter hints.
 */
export class RoutineTool implements ToolDefinition<TObject<TProperties>, RoutineResult> {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: TObject<TProperties>;

  private readonly routineName: string;

  constructor(
    routineName: string,
    flow: FlowDefinition,
    private readonly routineExecutor: RoutineExecutor,
  ) {
    this.routineName = routineName;
    this.name = routineName;
    this.label = RoutineTool.toLabel(routineName);
    this.parameters = RoutineTool.buildParamsSchema(flow, routineName);
    this.description = RoutineTool.buildDescription(flow, routineName);
  }

  async execute(
    _toolCallId: string,
    params: Record<string, string>,
    _signal: AbortSignal | undefined,
    _onUpdate: AgentToolUpdateCallback<RoutineResult> | undefined,
    _ctx: ExtensionContext,
  ): Promise<AgentToolResult<RoutineResult>> {
    const result = await this.routineExecutor.run(this.routineName, params);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      details: result,
    };
  }

  // ── Helpers ──────────────────────────────────────────────

  private static toLabel(name: string): string {
    return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private static buildParamsSchema(
    flow: FlowDefinition,
    routineName: string,
  ): TObject<TProperties> {
    const routine = flow.routines[routineName];
    const properties: Record<string, TSchema> = {};
    for (const param of routine?.params ?? []) {
      properties[param.name] = Type.String({
        description: param.description,
      });
    }
    return Type.Object(properties);
  }

  private static buildDescription(flow: FlowDefinition, routineName: string): string {
    const routine = flow.routines[routineName];
    const paramList = (routine?.params ?? []).map((p) => p.name).join(", ");
    return `Execute the "${routineName}" routine${paramList ? ` with params: ${paramList}` : ""}.`;
  }
}
