import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Generate `src/flows/flow-schema.json` as a hand-built JSON Schema document.
 *
 * We cannot import TypeBox schemas from FlowInstruction.ts for serialization
 * because TypeBox 1.3.0's internal memory system uses a deep clone that stack
 * overflows on the circular `steps` references (patched at module-init time
 * for Value.Check traversal).
 *
 * Instead, we define the JSON Schema objects directly and keep them in sync
 * with FlowInstruction.ts through the round-trip contract tests.
 */

// ── Individual defs ─────────────────────────────────────────

const defs: Record<string, unknown> = {
  Orchestrator: {
    type: "object",
    required: ["prompt"],
    properties: {
      prompt: { type: "string", minLength: 1 },
      activeTools: {
        type: "array",
        items: { type: "string", minLength: 1 },
      },
    },
  },

  FlowParam: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", minLength: 1 },
      description: { type: "string" },
    },
  },

  WorkspaceInstruction: {
    type: "object",
    required: ["id", "type"],
    properties: {
      id: { type: "string", minLength: 1 },
      type: { type: "string", const: "workspace" },
    },
  },

  AgentInstruction: {
    type: "object",
    required: ["id", "type", "spec", "task"],
    properties: {
      id: { type: "string", minLength: 1 },
      type: { type: "string", const: "agent" },
      spec: { type: "string", minLength: 1 },
      task: { type: "string" },
      workingDir: {
        anyOf: [
          { type: "string", const: "workspace" },
          { type: "string", minLength: 1 },
        ],
      },
      parseJson: { type: "boolean" },
    },
  },

  ParallelInstruction: {
    type: "object",
    required: ["id", "type"],
    properties: {
      id: { type: "string", minLength: 1 },
      type: { type: "string", const: "parallel" },
      steps: {
        type: "array",
        items: { $ref: "#/$defs/FlowInstruction" },
      },
    },
  },

  LoopInstruction: {
    type: "object",
    required: ["id", "type", "maxIterations"],
    properties: {
      id: { type: "string", minLength: 1 },
      type: { type: "string", const: "loop" },
      maxIterations: { type: "integer", minimum: 1 },
      continueWhile: { type: "string" },
      accumulateFrom: { type: "array", items: { type: "string" } },
      steps: {
        type: "array",
        items: { $ref: "#/$defs/FlowInstruction" },
      },
    },
  },

  CleanupInstruction: {
    type: "object",
    required: ["id", "type"],
    properties: {
      id: { type: "string", minLength: 1 },
      type: { type: "string", const: "cleanup" },
    },
  },

  ShellInstruction: {
    type: "object",
    required: ["id", "type", "command"],
    properties: {
      id: { type: "string", minLength: 1 },
      type: { type: "string", const: "shell" },
      command: { type: "string", minLength: 1 },
      cwd: { type: "string" },
    },
  },
};

defs.FlowInstruction = {
  anyOf: [
    { $ref: "#/$defs/WorkspaceInstruction" },
    { $ref: "#/$defs/AgentInstruction" },
    { $ref: "#/$defs/ParallelInstruction" },
    { $ref: "#/$defs/LoopInstruction" },
    { $ref: "#/$defs/CleanupInstruction" },
    { $ref: "#/$defs/ShellInstruction" },
  ],
};

defs.Routine = {
  type: "object",
  required: ["params", "steps"],
  properties: {
    params: {
      type: "array",
      items: { $ref: "#/$defs/FlowParam" },
    },
    steps: {
      type: "array",
      items: { $ref: "#/$defs/FlowInstruction" },
    },
  },
};

// ── Top-level schema ────────────────────────────────────────

const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Feature Forge Flow Definition",
  description:
    "Self-contained flow definition. " +
    "Declares a slash command, orchestrator prompt, and named routines with steps.",
  type: "object",
  required: ["name", "command", "orchestrator", "routines"],
  properties: {
    name: { type: "string", minLength: 1 },
    command: { type: "string", minLength: 1 },
    orchestrator: { $ref: "#/$defs/Orchestrator" },
    routines: {
      type: "object",
      additionalProperties: { $ref: "#/$defs/Routine" },
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
