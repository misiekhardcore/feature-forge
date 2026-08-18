import { Type } from "typebox";
import { Value } from "typebox/value";

import { ExpressionEvaluator } from "./ExpressionEvaluator";
import type { AgentInstruction, FlowDefinition, FlowInstruction } from "./FlowInstruction";
import {
  FlowDefinitionSchema,
  FlowInstructionSchema,
  isContainerInstruction,
  isLoopInstruction,
} from "./FlowInstruction";

/**
 * Pure flow validation functions (no I/O, no state).
 *
 * Validation layers:
 * 1. **Structural** — TypeBox schema (Value.Check).
 * 2. **Semantic** — rules TypeBox can't express: duplicate ids, invalid
 *    expressions, accumulateFrom references, unresolved workspace refs,
 *    unknown specs/providers.
 */

export function validateStructure(value: unknown): asserts value is FlowDefinition {
  if (!Value.Check(FlowDefinitionSchema, value)) {
    const errors = [...Value.Errors(FlowDefinitionSchema, value)].map(
      (e) => `  - ${e.instancePath}: ${e.message}`,
    );
    throw new Error(`Invalid flow definition:\n${errors.join("\n")}`);
  }

  // Validate each routine's steps against FlowInstructionSchema separately.
  // Type.Record in FlowDefinitionSchema uses Type.Any() for steps to avoid
  // a clone-induced stack overflow on the circular FlowInstructionUnion.
  validateRoutineSteps(value as FlowDefinition);
}

/**
 * Validate each routine's steps array against the full FlowInstruction schema.
 * Called from validateStructure after the top-level schema check passes.
 */
function validateRoutineSteps(flow: FlowDefinition): void {
  const stepsSchema = Type.Array(FlowInstructionSchema);
  const allErrors: string[] = [];
  for (const routine of flow.routines) {
    if (!Value.Check(stepsSchema, routine.steps)) {
      for (const e of Value.Errors(stepsSchema, routine.steps)) {
        allErrors.push(`  - /routines/${routine.id}/steps${e.instancePath}: ${e.message}`);
      }
    }
  }
  if (allErrors.length > 0) {
    throw new Error(`Invalid flow definition:\n${allErrors.join("\n")}`);
  }
}

export function validateSemantics(
  flow: FlowDefinition,
  knownSpecs?: ReadonlySet<string>,
  knownProviders?: ReadonlySet<string>,
): string[] {
  const errors: string[] = [];

  for (const routine of flow.routines) {
    const scope = `routine "${routine.id}"`;
    errors.push(...checkDuplicateIds(routine.steps, scope));
    walkInstructions(routine.steps, [], errors, knownSpecs, knownProviders, new Set());
  }

  // The orchestrator persona is required (schema-enforced) — verify its
  // systemPrompt names a spec that is actually loaded, so a broken flow fails
  // loudly at load instead of at command invocation (SpecManager.resolve).
  if (knownSpecs && !knownSpecs.has(flow.orchestrator.systemPrompt)) {
    errors.push(`Unknown orchestrator spec "${flow.orchestrator.systemPrompt}"`);
  }

  // Validate no duplicate routine IDs (lost compile-time guarantee from Record→Array migration).
  const routineIds = new Set<string>();
  for (const routine of flow.routines) {
    if (routineIds.has(routine.id)) {
      errors.push(`Duplicate routine id "${routine.id}"`);
    }
    routineIds.add(routine.id);
  }

  return errors;
}

function checkDuplicateIds(instructions: FlowInstruction[], scope: string): string[] {
  const seen = new Map<string, string>();
  const errors: string[] = [];
  collectIds(instructions, "", seen, errors, scope);
  return errors;
}

function collectIds(
  instructions: FlowInstruction[],
  parentPath: string,
  seen: Map<string, string>,
  errors: string[],
  scope: string,
): void {
  for (const instruction of instructions) {
    const instrPath = parentPath ? `${parentPath} → ${instruction.id}` : instruction.id;
    const firstPath = seen.get(instruction.id);
    if (firstPath !== undefined) {
      errors.push(
        `Duplicate instruction id "${instruction.id}" at "${scope} → ${instrPath}" ` +
          `(first seen at "${scope} → ${firstPath}")`,
      );
    } else {
      seen.set(instruction.id, instrPath);
    }
    if (isContainerInstruction(instruction)) {
      collectIds(instruction.steps, instrPath, seen, errors, scope);
    }
  }
}

function walkInstructions(
  instructions: FlowInstruction[],
  path: string[],
  errors: string[],
  knownSpecs?: ReadonlySet<string>,
  knownProviders?: ReadonlySet<string>,
  declaredWorkspaces: Set<string> = new Set(),
): void {
  for (const instruction of instructions) {
    const currentPath = [...path, instruction.id];

    if (instruction.type === "agent") {
      if (knownSpecs && !knownSpecs.has(instruction.systemPrompt)) {
        errors.push(
          `Unknown spec "${instruction.systemPrompt}" referenced by agent "${currentPath.join(" → ")}"`,
        );
      }

      // Validate workspace reference ordering.
      checkAgentWorkspaceRef(instruction, currentPath, errors, declaredWorkspaces);
    }

    if (instruction.type === "workspace") {
      declaredWorkspaces.add(instruction.id);

      if (knownProviders) {
        if (!knownProviders.has(instruction.provider)) {
          errors.push(
            `Unknown provider "${instruction.provider}" on workspace "${currentPath.join(" → ")}"`,
          );
        }
      }
    }

    if (instruction.type === "routine") {
      // Routine ref steps have no nested steps to walk — the target
      // flow is resolved at execution time, not load time.
      continue;
    }

    if (isLoopInstruction(instruction)) {
      checkLoopExpression(instruction, currentPath, errors);
      checkAccumulateFrom(instruction, currentPath, errors);
      walkInstructions(
        instruction.steps,
        currentPath,
        errors,
        knownSpecs,
        knownProviders,
        new Set(declaredWorkspaces),
      );
    }

    if (isContainerInstruction(instruction) && !isLoopInstruction(instruction)) {
      walkInstructions(
        instruction.steps,
        currentPath,
        errors,
        knownSpecs,
        knownProviders,
        new Set(declaredWorkspaces),
      );
    }
  }
}

/**
 * Validate that a `{workspace: "id"}` workingDir reference in an agent
 * instruction points to a workspace declared earlier in the same routine.
 */
function checkAgentWorkspaceRef(
  instruction: AgentInstruction,
  currentPath: string[],
  errors: string[],
  declaredWorkspaces: ReadonlySet<string>,
): void {
  if (!instruction.workingDir) return;
  if (!("workspace" in instruction.workingDir)) return;

  const workspaceId = instruction.workingDir.workspace;
  if (!declaredWorkspaces.has(workspaceId)) {
    errors.push(
      `Agent "${currentPath.join(" → ")}" references workspace "${workspaceId}" ` +
        `in workingDir, but no workspace with that id exists earlier in the same routine`,
    );
  }
}

/**
 * Validate that `while` and `continueWhile` expressions in a loop
 * instruction parse with the ExpressionEvaluator grammar.
 */
function checkLoopExpression(
  loop: FlowInstruction & { type: "loop" },
  path: string[],
  errors: string[],
): void {
  if (loop.while) {
    try {
      ExpressionEvaluator.parseExpression(loop.while);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      errors.push(`Invalid while expression in loop "${path.join(" → ")}": ${message}`);
    }
  }
  if (!loop.continueWhile) return;
  try {
    ExpressionEvaluator.parseExpression(loop.continueWhile);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    errors.push(`Invalid continueWhile expression in loop "${path.join(" → ")}": ${message}`);
  }
}

function checkAccumulateFrom(
  loop: FlowInstruction & { type: "loop" },
  path: string[],
  errors: string[],
): void {
  if (!loop.accumulateFrom || loop.accumulateFrom.length === 0) return;

  const reachableIds = new Set<string>();
  collectAllIds(loop.steps, reachableIds);

  const parseJsonIds = new Set<string>();
  collectIdsByFlag(loop.steps, "parseJson", parseJsonIds);

  // Routine ref instructions always produce a parsed result.
  const routineRefIds = new Set<string>();
  collectIdsByType(loop.steps, "routine", routineRefIds);

  for (const targetId of loop.accumulateFrom) {
    if (!reachableIds.has(targetId)) {
      errors.push(
        `accumulateFrom references unknown id "${targetId}" in loop ` +
          `"${path.join(" → ")}" (not found in loop body)`,
      );
    } else if (!parseJsonIds.has(targetId) && !routineRefIds.has(targetId)) {
      errors.push(
        `accumulateFrom id "${targetId}" points to an instruction ` +
          `without parseJson: true in loop "${path.join(" → ")}"`,
      );
    }
  }
}

function collectAllIds(instructions: FlowInstruction[], ids: Set<string>): void {
  for (const instruction of instructions) {
    ids.add(instruction.id);
    if (isContainerInstruction(instruction)) {
      collectAllIds(instruction.steps, ids);
    }
  }
}

function collectIdsByFlag(
  instructions: FlowInstruction[],
  flag: "parseJson",
  ids: Set<string>,
): void {
  for (const instruction of instructions) {
    if (flag in instruction && instruction[flag] === true) {
      ids.add(instruction.id);
    }
    if (isContainerInstruction(instruction)) {
      collectIdsByFlag(instruction.steps, flag, ids);
    }
  }
}

function collectIdsByType(instructions: FlowInstruction[], type: string, ids: Set<string>): void {
  for (const instruction of instructions) {
    if (instruction.type === type) {
      ids.add(instruction.id);
    }
    if (isContainerInstruction(instruction)) {
      collectIdsByType(instruction.steps, type, ids);
    }
  }
}
