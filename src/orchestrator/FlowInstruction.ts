import { TProperties, Type } from "typebox";

/**
 * ── Instruction schemas ────────────────────────────────────────
 *
 * TypeBox schemas ARE JSON Schema objects (per the TypeBox docs).
 *
 * For the recursive `steps` arrays, the runtime validation schema
 * uses a property mutation so Value.Check can traverse the circular
 * reference. The JSON Schema export uses a separate `$defs`-based
 * build (see generate-flow-schema.ts).
 */

/**
 * Create an instruction schema with the common `id` and `type` fields.
 */
function defineInstruction<Type extends string, Extra extends TProperties | undefined = undefined>(
  type: Type,
  extra?: Extra,
) {
  return Type.Object<
    Extra extends undefined
      ? { id: Type.TString; type: Type.TLiteral<Type> }
      : Extra & { id: Type.TString; type: Type.TLiteral<Type> }
  >(
    (extra
      ? {
          id: Type.String({ minLength: 1 }),
          type: Type.Literal(type),
          ...extra,
        }
      : {
          id: Type.String({ minLength: 1 }),
          type: Type.Literal(type),
        }) as Extra extends undefined
      ? { id: Type.TString; type: Type.TLiteral<Type> }
      : Extra & { id: Type.TString; type: Type.TLiteral<Type> },
  );
}

// ── Leaf schemas ────────────────────────────────────────────

export const WorkspaceInstructionSchema = defineInstruction("workspace");

export const AgentInstructionSchema = defineInstruction("agent", {
  spec: Type.String({ minLength: 1 }),
  task: Type.String(),
  workingDir: Type.Optional(Type.Union([Type.Literal("workspace"), Type.String({ minLength: 1 })])),
  parseJson: Type.Optional(Type.Boolean()),
});

export const CleanupInstructionSchema = defineInstruction("cleanup");

// ── Container schemas (steps added via patch below) ─────────

export const ParallelInstructionSchema = defineInstruction("parallel");

export const LoopInstructionSchema = defineInstruction("loop", {
  maxIterations: Type.Integer({ minimum: 1 }),
  continueWhile: Type.Optional(Type.String()),
  accumulateFrom: Type.Optional(Type.Array(Type.String())),
});

// ── Full union ───────────────────────────────────────────────

const FlowInstructionUnion = Type.Union([
  WorkspaceInstructionSchema,
  AgentInstructionSchema,
  ParallelInstructionSchema,
  LoopInstructionSchema,
  CleanupInstructionSchema,
]);

// Patch container schemas so `steps` validates recursively.
// TypeBox schemas are plain mutable objects — this runs at module-init
// time before any validation call. Value.Check traverses the object
// graph directly, so it handles the circular reference.
Object.defineProperty(ParallelInstructionSchema.properties, "steps", {
  value: Type.Array(FlowInstructionUnion),
  writable: true,
  enumerable: true,
  configurable: true,
});
Object.defineProperty(LoopInstructionSchema.properties, "steps", {
  value: Type.Array(FlowInstructionUnion),
  writable: true,
  enumerable: true,
  configurable: true,
});

// ── Runtime validation schema ────────────────────────────────

export const FlowInstructionSchema = FlowInstructionUnion;

export const OrchestratorSchema = Type.Object({
  task: Type.String({ minLength: 1 }),
});

export const FlowDefinitionSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  command: Type.String({ minLength: 1 }),
  tool: Type.String({ minLength: 1 }),
  toolParams: Type.Array(
    Type.Object({
      name: Type.String({ minLength: 1 }),
      description: Type.Optional(Type.String()),
    }),
  ),
  orchestrator: OrchestratorSchema,
  steps: Type.Array(FlowInstructionUnion),
});

// ── Explicit TypeScript types (kept in sync with schemas) ──

export type WorkspaceInstruction = Type.Static<typeof WorkspaceInstructionSchema>;

export type AgentInstruction = Type.Static<typeof AgentInstructionSchema>;

export type ParallelInstruction = Type.Static<typeof ParallelInstructionSchema> & {
  steps: FlowInstruction[];
};

export type LoopInstruction = Type.Static<typeof LoopInstructionSchema> & {
  steps: FlowInstruction[];
};

export type CleanupInstruction = Type.Static<typeof CleanupInstructionSchema>;

export type FlowInstruction =
  | WorkspaceInstruction
  | AgentInstruction
  | ParallelInstruction
  | LoopInstruction
  | CleanupInstruction;

export type Orchestrator = Type.Static<typeof OrchestratorSchema>;

export type FlowDefinition = Type.Static<typeof FlowDefinitionSchema> & {
  steps: FlowInstruction[];
};
