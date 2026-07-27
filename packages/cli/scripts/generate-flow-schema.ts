import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { TObject } from "typebox";

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
  routinesArray,
  SessionInstructionSchema,
  ShellInstructionSchema,
  WorkspaceInstructionSchema,
} from "../src/orchestrator/FlowInstruction.js";

/**
 * Generate `src/flows/flow-schema.json` from the TypeBox instruction schemas.
 *
 * The top-level structure (`required`, `properties.routines`) is derived from
 * {@link FlowDefinitionSchema}. Only what's needed for the recursive `steps`
 * cycle and the `$defs` block is hand-assembled:
 *
 * - `$defs.FlowInstruction` — an anyOf union with `$ref` pointers
 * - `orchestrator` → `$ref` to OrchestratorConfig
 * - `routines[].steps` → `$ref` to FlowInstruction
 * - Parallel / Loop `steps` → `$ref` to FlowInstruction
 *
 * Everything else (required arrays, property types, constraints) flows
 * directly from the TypeBox schemas.
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

// ── Top-level schema: derived from FlowDefinitionSchema ─────
// The only override: routines[].steps gets a $ref to break the cycle.
// We cast through Record<string, unknown> because TypeBox property types
// are typed objects — replacing them with raw JSON Schema objects (e.g.
// $refs, inline literals) needs a type escape.

const properties = structuredClone(FlowDefinitionSchema.properties);
properties.orchestrator = { $ref: "#/$defs/OrchestratorConfig" };

// Clone the TypeBox routinesArray and replace only the recursive `steps`
// with a $ref — everything else (id, params shape, minLength) comes from TypeBox.
const routinesDef = structuredClone(routinesArray);
routinesDef.items.properties.steps = { type: "array", items: { $ref: "#/$defs/FlowInstruction" } };
properties.routines = routinesDef;

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

function replaceStepsRef(containerSchema: TObject) {
  const clone = structuredClone<TObject>(containerSchema);
  const props = clone.properties;
  if (props?.steps) {
    props.steps = {
      type: "array",
      items: { $ref: "#/$defs/FlowInstruction" },
    };
  }
  return clone;
}
