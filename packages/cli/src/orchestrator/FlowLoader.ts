import * as fs from "node:fs/promises";
import * as path from "node:path";

import { jsonParse } from "@feature-forge/shared";
import { Type } from "typebox";
import { Value } from "typebox/value";

import { logger } from "../logging";
import { ExpressionEvaluator } from "./ExpressionEvaluator";
import type { AgentInstruction, FlowDefinition, FlowInstruction } from "./FlowInstruction";
import {
  FlowDefinitionSchema,
  FlowInstructionSchema,
  isContainerInstruction,
  isLoopInstruction,
} from "./FlowInstruction";

/**
 * Loads and validates declarative routine-based flow JSON files.
 *
 * Validation layers:
 * 1. **Structural** — TypeBox schema (Value.Check).
 * 2. **Semantic** — rules TypeBox can't express: duplicate ids, invalid
 *    expressions, accumulateFrom references, unresolved workspace refs,
 *    unknown specs/providers.
 */
export class FlowLoader {
  constructor(
    private readonly params: {
      flowsDir: string;
      knownSpecs?: ReadonlySet<string>;
      knownProviders?: ReadonlySet<string>;
    },
  ) {}

  async load(name: string): Promise<FlowDefinition> {
    const filepath = path.join(this.params.flowsDir, `${name}.json`);
    logger.info("Loading flow", { name, filepath });

    let raw: string;
    try {
      raw = await fs.readFile(filepath, "utf-8");
    } catch (error) {
      logger.warn("Flow file not found", { name, filepath });
      throw new Error(`Flow "${name}" not found at ${filepath}`, { cause: error });
    }

    let parsed: unknown;
    try {
      parsed = jsonParse(raw);
    } catch (error) {
      logger.error("Flow contains invalid JSON", { name, error: (error as Error).message });
      throw new Error(`Flow "${name}" contains invalid JSON: ${(error as Error).message}`, {
        cause: error,
      });
    }

    try {
      FlowLoader.validateStructure(parsed);
    } catch (error) {
      logger.error("Flow structural validation failed", { name, error: (error as Error).message });
      throw error;
    }

    const semanticErrors = FlowLoader.validateSemantics(
      parsed,
      this.params.knownSpecs,
      this.params.knownProviders,
    );
    if (semanticErrors.length > 0) {
      logger.error("Flow semantic validation failed", { name, errors: semanticErrors });
      throw new Error(
        `Flow "${name}" has semantic errors:\n${semanticErrors.map((e) => `  - ${e}`).join("\n")}`,
      );
    }

    logger.info("Flow loaded successfully", { name });
    return parsed;
  }

  async loadAll(): Promise<{ flows: Map<string, FlowDefinition>; failures: Map<string, Error> }> {
    const flows = new Map<string, FlowDefinition>();
    const failures = new Map<string, Error>();
    const files = await fs.readdir(this.params.flowsDir);
    const jsonFiles = files.filter((f) => f.endsWith(".json") && f !== "flow-schema.json");

    logger.info("Loading all flows from directory", {
      dir: this.params.flowsDir,
      count: jsonFiles.length,
    });

    for (const file of jsonFiles) {
      const name = path.basename(file, ".json");
      try {
        flows.set(name, await this.load(name));
      } catch (error) {
        logger.warn("Skipping invalid flow", { name, error: (error as Error).message });
        failures.set(name, error instanceof Error ? error : new Error(String(error)));
      }
    }

    logger.info("All flows loaded", { loaded: flows.size, failed: failures.size });
    return { flows, failures };
  }

  static validateStructure(value: unknown): asserts value is FlowDefinition {
    if (!Value.Check(FlowDefinitionSchema, value)) {
      const errors = [...Value.Errors(FlowDefinitionSchema, value)].map(
        (e) => `  - ${e.instancePath}: ${e.message}`,
      );
      throw new Error(`Invalid flow definition:\n${errors.join("\n")}`);
    }

    // Validate each routine's steps against FlowInstructionSchema separately.
    // Type.Record in FlowDefinitionSchema uses Type.Any() for steps to avoid
    // a clone-induced stack overflow on the circular FlowInstructionUnion.
    FlowLoader.validateRoutineSteps(value);
  }

  /**
   * Validate each routine's steps array against the full FlowInstruction schema.
   * Called from validateStructure after the top-level schema check passes.
   */
  private static validateRoutineSteps(flow: FlowDefinition): void {
    const stepsSchema = Type.Array(FlowInstructionSchema);
    const allErrors: string[] = [];
    for (const [routineName, routine] of Object.entries(flow.routines)) {
      if (!Value.Check(stepsSchema, routine.steps)) {
        for (const e of Value.Errors(stepsSchema, routine.steps)) {
          allErrors.push(`  - /routines/${routineName}/steps${e.instancePath}: ${e.message}`);
        }
      }
    }
    if (allErrors.length > 0) {
      throw new Error(`Invalid flow definition:\n${allErrors.join("\n")}`);
    }
  }

  static validateSemantics(
    flow: FlowDefinition,
    knownSpecs?: ReadonlySet<string>,
    knownProviders?: ReadonlySet<string>,
  ): string[] {
    const errors: string[] = [];

    for (const [routineName, routine] of Object.entries(flow.routines)) {
      const scope = `routine "${routineName}"`;
      errors.push(...FlowLoader.checkDuplicateIds(routine.steps as FlowInstruction[], scope));
      FlowLoader.walkInstructions(
        routine.steps as FlowInstruction[],
        [],
        errors,
        knownSpecs,
        knownProviders,
        new Set(),
      );
    }

    return errors;
  }

  private static checkDuplicateIds(instructions: FlowInstruction[], scope: string): string[] {
    const seen = new Map<string, string>();
    const errors: string[] = [];
    FlowLoader.collectIds(instructions, "", seen, errors, scope);
    return errors;
  }

  private static collectIds(
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
        FlowLoader.collectIds(instruction.steps, instrPath, seen, errors, scope);
      }
    }
  }

  private static walkInstructions(
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
        FlowLoader.checkAgentWorkspaceRef(instruction, currentPath, errors, declaredWorkspaces);
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

      if (isLoopInstruction(instruction)) {
        FlowLoader.checkLoopExpression(instruction, currentPath, errors);
        FlowLoader.checkAccumulateFrom(instruction, currentPath, errors);
        FlowLoader.walkInstructions(
          instruction.steps,
          currentPath,
          errors,
          knownSpecs,
          knownProviders,
          new Set(declaredWorkspaces),
        );
      }

      if (isContainerInstruction(instruction) && !isLoopInstruction(instruction)) {
        FlowLoader.walkInstructions(
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
  private static checkAgentWorkspaceRef(
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

  private static checkLoopExpression(
    loop: FlowInstruction & { type: "loop" },
    path: string[],
    errors: string[],
  ): void {
    if (!loop.continueWhile) return;
    try {
      ExpressionEvaluator.parseExpression(loop.continueWhile);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      errors.push(`Invalid continueWhile expression in loop "${path.join(" → ")}": ${message}`);
    }
  }

  private static checkAccumulateFrom(
    loop: FlowInstruction & { type: "loop" },
    path: string[],
    errors: string[],
  ): void {
    if (!loop.accumulateFrom || loop.accumulateFrom.length === 0) return;

    const reachableIds = new Set<string>();
    FlowLoader.collectAllIds(loop.steps, reachableIds);

    const parseJsonIds = new Set<string>();
    FlowLoader.collectIdsByFlag(loop.steps, "parseJson", parseJsonIds);

    for (const targetId of loop.accumulateFrom) {
      if (!reachableIds.has(targetId)) {
        errors.push(
          `accumulateFrom references unknown id "${targetId}" in loop ` +
            `"${path.join(" → ")}" (not found in loop body)`,
        );
      } else if (!parseJsonIds.has(targetId)) {
        errors.push(
          `accumulateFrom id "${targetId}" points to an instruction ` +
            `without parseJson: true in loop "${path.join(" → ")}"`,
        );
      }
    }
  }

  private static collectAllIds(instructions: FlowInstruction[], ids: Set<string>): void {
    for (const instruction of instructions) {
      ids.add(instruction.id);
      if (isContainerInstruction(instruction)) {
        FlowLoader.collectAllIds(instruction.steps, ids);
      }
    }
  }

  private static collectIdsByFlag(
    instructions: FlowInstruction[],
    flag: "parseJson",
    ids: Set<string>,
  ): void {
    for (const instruction of instructions) {
      if (flag in instruction && instruction[flag] === true) {
        ids.add(instruction.id);
      }
      if (isContainerInstruction(instruction)) {
        FlowLoader.collectIdsByFlag(instruction.steps, flag, ids);
      }
    }
  }
}
