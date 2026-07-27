import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { TObject } from "typebox";

import {
  AgentInstructionSchema,
  CleanupInstructionSchema,
  FlowDefinitionSchema,
  GitInstructionSchema,
  LoopInstructionSchema,
  OrchestratorConfigSchema,
  ParallelInstructionSchema,
  RoutineParamSchema,
  RoutineRefInstructionSchema,
  routines,
  SessionInstructionSchema,
  ShellInstructionSchema,
  WorkspaceInstructionSchema,
} from "../src/orchestrator/FlowInstruction.js";

/**
 * Generate `src/flows/flow-schema.json` from the TypeBox instruction schemas.
 *
 * Nearly everything is derived directly from the TypeBox schemas. The only
 * manual work is for `$ref` pointers that AJV requires but TypeBox 1.1
 * doesn't produce natively:
 *
 * - `$defs.FlowInstruction` — an anyOf union listing every instruction type
 *   via $ref. TypeBox would inline Type.Ref instead.
 * - `orchestrator` → `$ref` to OrchestratorConfig
 *   TypeBox stores `{ $ref: "OrchestratorConfig" }` (bare name); AJV needs
 *   the `#/$defs/` prefix.
 * - `steps` arrays in routines, Parallel, Loop → `$ref` to FlowInstruction
 *   These circularly reference the union; need $ref to avoid infinite inline.
 *
 * Everything else (required arrays, id minLength, params shape, OrchestratorConfig
 * properties, all instruction property definitions) flows from TypeBox unchanged.
 */

// ── Constants ─────────────────────────────────────────────

const META_SCHEMA_URL = "https://json-schema.org/draft/2020-12/schema";

// ── $defs: instruction schemas + FlowInstruction union ─────
// `replaceStepsRef` swaps inline `steps` for `$ref` in containers
// that reference FlowInstruction recursively (Parallel, Loop).
// The `anyOf` list is hand-written because TypeBox 1.1 inlines
// `Type.Ref` instead of keeping `$ref` pointers.

const defs: Record<string, unknown> = {
  OrchestratorConfig: OrchestratorConfigSchema,
  RoutineParam: RoutineParamSchema,
  WorkspaceInstruction: WorkspaceInstructionSchema,
  AgentInstruction: AgentInstructionSchema,
  ParallelInstruction: replaceStepsRef(ParallelInstructionSchema),
  LoopInstruction: replaceStepsRef(LoopInstructionSchema),
  CleanupInstruction: CleanupInstructionSchema,
  GitInstruction: GitInstructionSchema,
  SessionInstruction: SessionInstructionSchema,
  ShellInstruction: ShellInstructionSchema,
  RoutineRefInstruction: RoutineRefInstructionSchema,
  FlowInstruction: {
    anyOf: [
      { $ref: "#/$defs/WorkspaceInstruction" },
      { $ref: "#/$defs/AgentInstruction" },
      { $ref: "#/$defs/ParallelInstruction" },
      { $ref: "#/$defs/LoopInstruction" },
      { $ref: "#/$defs/CleanupInstruction" },
      { $ref: "#/$defs/GitInstruction" },
      { $ref: "#/$defs/SessionInstruction" },
      { $ref: "#/$defs/ShellInstruction" },
      { $ref: "#/$defs/RoutineRefInstruction" },
    ],
  },
};

// ── Top-level properties: derived from FlowDefinitionSchema ──

const properties = structuredClone(FlowDefinitionSchema.properties) as Record<string, unknown>;

// Fix TypeBox's bare `$ref` → AJV-compatible `#/$defs/` prefix.
properties.orchestrator = { $ref: "#/$defs/OrchestratorConfig" };

// Replace inline `steps` with `$ref` in routines items.

const routinesClone = structuredClone(routines);
routinesClone.items.properties.steps = {
  type: "array",
  // @ts-expect-error overrides the type
  items: { $ref: "#/$defs/FlowInstruction" },
};

properties.routines = routinesClone;

// ── Assemble ────────────────────────────────────────────────

const schema: Record<string, unknown> = {
  $schema: META_SCHEMA_URL,
  title: "Feature Forge Flow Definition",
  description:
    "Self-contained flow definition. " +
    "Declares a slash command, orchestrator config, and named deterministic routines.",
  type: "object",
  required: FlowDefinitionSchema.required,
  properties,
  $defs: defs,
};

// ── Write ───────────────────────────────────────────────────

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(scriptDir, "..", "src", "flows");
fs.mkdirSync(outDir, { recursive: true });

const outPath = path.join(outDir, "flow-schema.json");
fs.writeFileSync(outPath, JSON.stringify(schema, null, 2) + "\n");

console.log(`Wrote flow-schema.json to ${outPath}`);
// ── Helpers ─────────────────────────────────────────────────

function replaceStepsRef<ObjectType extends TObject>(containerSchema: ObjectType) {
  const clone = structuredClone<TObject>(containerSchema);
  const props = clone.properties;
  if (props?.steps) {
    props.steps = {
      type: "array",
      items: { $ref: "#/$defs/FlowInstruction" },
    };
  }
  return clone as ObjectType & {
    steps: { type: "array"; items: { $ref: "#/$defs/FlowInstruction" } };
  };
}
