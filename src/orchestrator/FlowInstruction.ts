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
  specInput: Type.Optional(Type.Record(Type.String(), Type.String())),
});

export const CleanupInstructionSchema = defineInstruction("cleanup");

export const ShellInstructionSchema = defineInstruction("shell", {
  command: Type.String({ minLength: 1 }),
  cwd: Type.Optional(Type.String()),
});

// ── Parallel failure mode ──────────────────────────────────

export const ParallelFailureModeSchema = Type.Union([
  Type.Literal("fail_fast"),
  Type.Literal("continue_on_error"),
  Type.Literal("all_or_nothing"),
]);

export type ParallelFailureMode = Type.Static<typeof ParallelFailureModeSchema>;

// ── Container schemas (steps added via patch below) ─────────

export const ParallelInstructionSchema = defineInstruction("parallel", {
  failureMode: Type.Optional(ParallelFailureModeSchema),
});

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
  ShellInstructionSchema,
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

/** Reused parameter shape from ADR 0003 D.2 — a named parameter with optional description. */
const FlowParamSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
});

/**
 * A routine is a named sequence of flow instructions with declared parameters.
 * Each routine defines its own `params` array; there is no top-level `toolParams`.
 *
 * `steps` is patched in below (same pattern as parallel/loop) to avoid
 * TypeBox's internal clone from encountering the circular FlowInstructionUnion
 * reference at module-init time (which would stack-overflow clone.mjs).
 */
export const RoutineSchema = Type.Object({
  params: Type.Array(FlowParamSchema),
});

// Patch RoutineSchema so `steps` validates recursively.
// Same pattern as parallel/loop — must run after FlowInstructionUnion is defined
// and after RoutineSchema is declared.
Object.defineProperty(RoutineSchema.properties, "steps", {
  value: Type.Array(FlowInstructionUnion),
  writable: true,
  enumerable: true,
  configurable: true,
});

export const OrchestratorSchema = Type.Object({
  prompt: Type.String({ minLength: 1 }),
  activeTools: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
});

/**
 * Routines map schema — manually constructed to avoid Type.Record's internal
 * clone of the value schema, which stack-overflows on circular FlowInstructionUnion
 * references (clone.mjs).
 *
 * Uses `patternProperties` (same structure Type.Record produces) to validate
 * every routine key against RoutineSchema. TypeBox's Value.Check handles
 * patternProperties natively.
 */
const RoutinesMapSchema = {
  type: "object" as const,
  patternProperties: {
    "^.*$": RoutineSchema as unknown,
  },
};

export const FlowDefinitionSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  command: Type.String({ minLength: 1 }),
  orchestrator: OrchestratorSchema,
  routines: RoutinesMapSchema as unknown as ReturnType<typeof Type.Object>["properties"][string],
});

// ── Explicit TypeScript types (kept in sync with schemas) ──

export type WorkspaceInstruction = Type.Static<typeof WorkspaceInstructionSchema>;

export type AgentInstruction = Type.Static<typeof AgentInstructionSchema>;

export type ParallelInstruction = Type.Static<typeof ParallelInstructionSchema> & {
  steps: FlowInstruction[];
  failureMode?: ParallelFailureMode;
};

export type LoopInstruction = Type.Static<typeof LoopInstructionSchema> & {
  steps: FlowInstruction[];
};

export type CleanupInstruction = Type.Static<typeof CleanupInstructionSchema>;

export type ShellInstruction = Type.Static<typeof ShellInstructionSchema>;

export type FlowInstruction =
  | WorkspaceInstruction
  | AgentInstruction
  | ParallelInstruction
  | LoopInstruction
  | CleanupInstruction
  | ShellInstruction;

export type FlowParam = Type.Static<typeof FlowParamSchema>;

export type Routine = Type.Static<typeof RoutineSchema> & {
  steps: FlowInstruction[];
};

export type Orchestrator = Type.Static<typeof OrchestratorSchema>;

export type FlowDefinition = Type.Static<typeof FlowDefinitionSchema> & {
  routines: Record<string, Routine>;
};
