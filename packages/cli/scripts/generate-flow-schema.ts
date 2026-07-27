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
  SessionInstructionSchema,
  ShellInstructionSchema,
  WorkspaceInstructionSchema,
} from "../src/orchestrator/FlowInstruction.js";

/**
 * Generate `src/flows/flow-schema.json` from the TypeBox instruction schemas.
 *
 * The top-level {@link FlowDefinitionSchema} drives the output structure
 * (`required`, `properties`). The only manual override is `routines[].steps` —
 * that array refers back to `FlowInstruction`, which creates a cycle. We replace
 * it with a `$ref` so the output stays a valid JSON Schema document.
 *
 * Container schemas (parallel, loop) also have their `steps` replaced with
 * a `$ref` for the same reason.
 */

// ── Constants ─────────────────────────────────────────────

const META_SCHEMA_URL = "https://json-schema.org/draft/2020-12/schema";

// ── Build individual defs (TypeBox schemas → JSON Schema) ──

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
};

defs.RoutineRefInstruction = RoutineRefInstructionSchema;

defs.FlowInstruction = {
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
};

// ── Top-level schema: derived from FlowDefinitionSchema ─────
// The only override: routines[].steps gets a $ref to break the cycle.
// We cast through Record<string, unknown> because TypeBox property types
// are typed objects — replacing them with raw JSON Schema objects (e.g.
// $refs, inline literals) needs a type escape.

const topProps = structuredClone(FlowDefinitionSchema.properties) as Record<string, unknown>;
topProps.orchestrator = { $ref: "#/$defs/OrchestratorConfig" };
topProps.routines = {
  type: "array",
  items: {
    type: "object",
    required: ["id", "params", "steps"],
    properties: {
      id: { type: "string", minLength: 1 },
      params: { type: "array", items: { $ref: "#/$defs/RoutineParam" } },
      steps: {
        type: "array",
        items: { $ref: "#/$defs/FlowInstruction" },
      },
    },
  },
};

const schema: Record<string, unknown> = {
  $schema: META_SCHEMA_URL,
  title: "Feature Forge Flow Definition",
  description:
    "Self-contained flow definition. " +
    "Declares a slash command, orchestrator config, and named deterministic routines.",
  type: "object",
  required: FlowDefinitionSchema.required ?? [],
  properties: topProps,
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
