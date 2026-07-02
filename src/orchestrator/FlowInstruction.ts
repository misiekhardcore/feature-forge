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

export const WorkspaceInstructionSchema = defineInstruction("workspace", {
  provider: Type.Union([Type.Literal("git-worktree"), Type.Literal("current-dir")]),
});

export const AgentInstructionSchema = defineInstruction("agent", {
  systemPrompt: Type.String({ minLength: 1 }),
  prompt: Type.String(),
  workingDir: Type.Optional(
    Type.Union([
      Type.Object({ workspace: Type.String({ minLength: 1 }) }),
      Type.Object({ path: Type.String({ minLength: 1 }) }),
    ]),
  ),
  parseJson: Type.Optional(Type.Boolean()),
  promptParams: Type.Optional(Type.Record(Type.String(), Type.String())),
});

export const CleanupInstructionSchema = defineInstruction("cleanup", {
  of: Type.Optional(Type.String({ minLength: 1 })),
});

export const GitInstructionSchema = defineInstruction("git", {
  action: Type.Union([Type.Literal("add-and-commit"), Type.Literal("push-current")]),
  cwd: Type.String({ minLength: 1 }),
  message: Type.Optional(Type.String({ minLength: 1 })),
});

export const ShellInstructionSchema = defineInstruction("shell", {
  command: Type.String({ minLength: 1 }),
  cwd: Type.String({ minLength: 1 }),
});

// ── Container schemas (steps added via patch below) ─────────

export const ParallelInstructionSchema = defineInstruction("parallel");

/**
 * Loop instruction schema.
 *
 * **Do-while semantics**: the loop body (`steps`) always executes at least
 * once. The `continueWhile` condition is evaluated **after** each iteration,
 * so the body runs before the first check. When `continueWhile` is omitted
 * the loop runs exactly `maxIterations` times.
 */
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
  GitInstructionSchema,
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

export const OrchestratorConfigSchema = Type.Object({
  systemPrompt: Type.String({ minLength: 1 }),
  prompt: Type.Optional(Type.String()),
  promptParams: Type.Optional(Type.Record(Type.String(), Type.String())),
});

export const RoutineParamSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
});

const RoutineDefinitionSchema = Type.Object({
  params: Type.Array(RoutineParamSchema),
  // steps placeholder — Type.Any() avoids the circular FlowInstructionUnion reference
  // during Type.Record's internal Clone. The real validator is patched onto the
  // cloned copy stored inside the TRecord below.
  steps: Type.Any(),
});

export const FlowDefinitionSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  command: Type.String({ minLength: 1 }),
  orchestrator: OrchestratorConfigSchema,
  routines: Type.Record(Type.String(), RoutineDefinitionSchema),
});

// After Type.Record has cloned RoutineDefinitionSchema (with Type.Any() for steps
// to avoid the circular clone), patch the cloned copy inside the TRecord with the
// real FlowInstructionUnion-based validator so Value.Check can reject invalid
// nested instructions.
const _recordSchema = FlowDefinitionSchema.properties.routines;
const _patterns: Record<string, { properties: object }> = _recordSchema.patternProperties ?? {};
for (const _patternKey of Object.keys(_patterns)) {
  const _clonedRoutine = _patterns[_patternKey];
  if (_clonedRoutine?.properties) {
    Object.defineProperty(_clonedRoutine.properties, "steps", {
      value: Type.Array(FlowInstructionUnion),
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
}

// ── Explicit TypeScript types ─────────────────────────────────

export type WorkspaceInstruction = Type.Static<typeof WorkspaceInstructionSchema>;

export type AgentInstruction = Type.Static<typeof AgentInstructionSchema>;

export type ParallelInstruction = Type.Static<typeof ParallelInstructionSchema> & {
  steps: FlowInstruction[];
};

export type LoopInstruction = Type.Static<typeof LoopInstructionSchema> & {
  steps: FlowInstruction[];
};

export type CleanupInstruction = Type.Static<typeof CleanupInstructionSchema>;

export type GitInstruction = Type.Static<typeof GitInstructionSchema>;

export type ShellInstruction = Type.Static<typeof ShellInstructionSchema>;

/** Instructions that contain nested `steps` arrays. */
export type ContainerInstruction = ParallelInstruction | LoopInstruction;

export type FlowInstruction =
  | WorkspaceInstruction
  | AgentInstruction
  | ParallelInstruction
  | LoopInstruction
  | CleanupInstruction
  | GitInstruction
  | ShellInstruction;

export type OrchestratorConfig = Type.Static<typeof OrchestratorConfigSchema>;

export type RoutineParam = Type.Static<typeof RoutineParamSchema>;

export type RoutineDefinition = {
  params: RoutineParam[];
  steps: FlowInstruction[];
};

export type FlowDefinition = Type.Static<typeof FlowDefinitionSchema> & {
  routines: Record<string, RoutineDefinition>;
};

// ── Type guard functions ──────────────────────────────────────

export function isParallelInstruction(instr: FlowInstruction): instr is ParallelInstruction {
  return instr.type === "parallel";
}

export function isLoopInstruction(instr: FlowInstruction): instr is LoopInstruction {
  return instr.type === "loop";
}

export function isContainerInstruction(instr: FlowInstruction): instr is ContainerInstruction {
  return instr.type === "parallel" || instr.type === "loop";
}

// ── Helper constructors ────────────────────────────────────────

export function makeParallelInstruction(id: string, steps: FlowInstruction[]): ParallelInstruction {
  return { type: "parallel", id, steps } as ParallelInstruction;
}

export function makeLoopInstruction(
  id: string,
  maxIterations: number,
  steps: FlowInstruction[],
  continueWhile?: string,
  accumulateFrom?: string[],
): LoopInstruction {
  const base: LoopInstruction = { type: "loop", id, maxIterations, steps } as LoopInstruction;
  if (continueWhile !== undefined) base.continueWhile = continueWhile;
  if (accumulateFrom !== undefined) base.accumulateFrom = accumulateFrom;
  return base;
}
