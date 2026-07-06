import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

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
 * TypeBox schemas ARE JSON Schema objects — we don't transform them,
 * we just compose them into a `$defs`-based document so the recursive
 * `steps` arrays use `$ref` pointers instead of object-level cycles.
 *
 * Container schemas (parallel, loop) have `steps` added via a property
 * patch at module-init time. We clone them and replace `steps` with a
 * `$ref` to `FlowInstruction` for the export.
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
  RoutineRefInstruction: RoutineRefInstructionSchema,
};

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

// ── Top-level schema ────────────────────────────────────────

const schema = {
  $schema: META_SCHEMA_URL,
  title: "Feature Forge Flow Definition",
  description:
    "Self-contained flow definition. " +
    "Declares a slash command, orchestrator config, and named deterministic routines.",
  type: "object",
  required: ["$schema", "name", "command", "orchestrator", "routines"],
  properties: {
    $schema: FlowDefinitionSchema.properties.$schema,
    name: { type: "string", minLength: 1 },
    command: { type: "string", minLength: 1 },
    orchestrator: { $ref: "#/$defs/OrchestratorConfig" },
    routines: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["params", "steps"],
        properties: {
          params: { type: "array", items: { $ref: "#/$defs/RoutineParam" } },
          steps: {
            type: "array",
            items: { $ref: "#/$defs/FlowInstruction" },
          },
        },
      },
    },
  },
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

function replaceStepsRef(containerSchema: unknown): Record<string, unknown> {
  const clone = structuredClone(containerSchema) as Record<string, unknown>;
  const props = clone.properties as Record<string, unknown> | undefined;
  if (props?.steps) {
    props.steps = {
      type: "array",
      items: { $ref: "#/$defs/FlowInstruction" },
    };
  }
  return clone;
}
