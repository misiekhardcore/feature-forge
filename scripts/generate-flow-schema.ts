import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AgentInstructionSchema,
  CleanupInstructionSchema,
  LoopInstructionSchema,
  OrchestratorSchema,
  ParallelInstructionSchema,
  WorkspaceInstructionSchema,
} from "../src/orchestrator/FlowInstruction";

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

// ── Build individual defs (TypeBox schemas → JSON Schema) ──

const defs: Record<string, unknown> = {
  Orchestrator: OrchestratorSchema,
  WorkspaceInstruction: WorkspaceInstructionSchema,
  AgentInstruction: AgentInstructionSchema,
  ParallelInstruction: replaceStepsRef(ParallelInstructionSchema),
  LoopInstruction: replaceStepsRef(LoopInstructionSchema),
  CleanupInstruction: CleanupInstructionSchema,
};

defs.FlowInstruction = {
  anyOf: [
    { $ref: "#/$defs/WorkspaceInstruction" },
    { $ref: "#/$defs/AgentInstruction" },
    { $ref: "#/$defs/ParallelInstruction" },
    { $ref: "#/$defs/LoopInstruction" },
    { $ref: "#/$defs/CleanupInstruction" },
  ],
};

// ── Top-level schema ────────────────────────────────────────

const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Feature Forge Flow Definition",
  description:
    "Self-contained flow definition. " +
    "Declares a slash command, orchestrator prompt, tool, and deterministic steps.",
  type: "object",
  required: ["name", "command", "tool", "toolParams", "orchestrator", "steps"],
  properties: {
    name: { type: "string", minLength: 1 },
    command: { type: "string", minLength: 1 },
    tool: { type: "string", minLength: 1 },
    toolParams: { type: "array", items: { type: "string" } },
    orchestrator: { $ref: "#/$defs/Orchestrator" },
    steps: {
      type: "array",
      items: { $ref: "#/$defs/FlowInstruction" },
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

/**
 * Replace a container schema's `steps` with a `$ref` to `FlowInstruction`.
 * The schema object is cloned so the runtime validation schemas are not mutated.
 */
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
