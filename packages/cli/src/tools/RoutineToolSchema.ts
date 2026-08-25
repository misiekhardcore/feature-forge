import type { RoutineDefinition } from "@feature-forge/core/flows";
import { type TObject, type TProperties, Type } from "typebox";

/**
 * Static builders for the schema and description a {@link RoutineTool}
 * exposes to the LLM.
 *
 * Pure functions of the routine definition: no I/O, no instance state.
 */
export class RoutineToolSchema {
  /** Static utility class - not instantiable. */
  private constructor() {}

  /**
   * Builds the tool parameter schema from a routine's declared `params` array.
   * Each param becomes a string property; optional params are wrapped in
   * `Type.Optional` so they are excluded from the schema's `required` array.
   */
  static buildParamsSchema(routineDef: RoutineDefinition): TObject<TProperties> {
    const properties: Record<string, ReturnType<typeof Type.String>> = {};
    for (const param of routineDef.params) {
      const schema = Type.String({
        description: param.description,
      });
      properties[param.name] = param.optional ? Type.Optional(schema) : schema;
    }
    return Type.Object(properties);
  }

  /**
   * Builds the tool description from a routine's name and declared params.
   * With params, each is rendered as `name (description) [optional]` and
   * appended to the (possibly custom) base description.
   */
  static buildDescription(routineName: string, routineDef: RoutineDefinition): string {
    if (routineDef.params.length === 0) {
      return routineDef.description ?? `Run the "${routineName}" routine.`;
    }
    const paramList = routineDef.params
      .map(
        (p) =>
          `${p.name}${p.description ? ` (${p.description})` : ""}${p.optional ? " [optional]" : ""}`,
      )
      .join(", ");
    const base = routineDef.description ?? `Run the "${routineName}" routine with params`;
    return `${base}: ${paramList}.`;
  }
}
