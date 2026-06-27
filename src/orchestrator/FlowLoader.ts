import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Value } from "typebox/value";

import { logger } from "../logging";
import { ExpressionEvaluator } from "./ExpressionEvaluator";
import type { FlowDefinition, FlowInstruction } from "./FlowInstruction";
import { FlowDefinitionSchema } from "./FlowInstruction";

/**
 * TypeBox 1.3.0's Type.Static can't see the runtime-patched `steps`
 * property on parallel/loop schemas. Access container steps through
 * this helper to avoid TS2339/TS2353 errors.
 */
function containerSteps(instr: FlowInstruction): FlowInstruction[] {
  return (instr as unknown as { steps: FlowInstruction[] }).steps;
}

/**
 * Loads and validates declarative flow JSON files.
 *
 * Validation happens in two layers:
 * 1. **Structural** — TypeBox schema (Value.Check). Catches wrong types,
 *    missing required fields, invalid literals.
 * 2. **Semantic** — rules TypeBox can't express. Duplicate ids, invalid
 *    expressions, accumulateFrom references to unknown or non-direct-child
 *    ids, empty loop bodies.
 */
export class FlowLoader {
  constructor(
    private readonly flowsDir: string,
    private readonly knownSpecs?: ReadonlySet<string>,
  ) {}

  // ── Instance methods ──────────────────────────────────────

  /**
   * Load a single flow by name (filename without .json extension).
   *
   * @throws if the file doesn't exist, isn't valid JSON, or fails
   *         structural or semantic validation.
   */
  async load(name: string): Promise<FlowDefinition> {
    const filepath = path.join(this.flowsDir, `${name}.json`);
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
      parsed = JSON.parse(raw);
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

    const semanticErrors = FlowLoader.validateSemantics(parsed, this.knownSpecs);
    if (semanticErrors.length > 0) {
      logger.error("Flow semantic validation failed", { name, errors: semanticErrors });
      throw new Error(
        `Flow "${name}" has semantic errors:\n${semanticErrors.map((e) => `  - ${e}`).join("\n")}`,
      );
    }

    logger.info("Flow loaded successfully", { name });
    return parsed;
  }

  /**
   * Load all .json files from the flows directory, skipping the
   * internal schema file.
   *
   * Failures from individual files are collected rather than aborting
   * the whole load — one bad flow won't prevent the rest from loading.
   *
   * @returns loaded flows and a map of flow name → error for any that
   *   failed to load or validate.
   */
  async loadAll(): Promise<{
    flows: Map<string, FlowDefinition>;
    failures: Map<string, Error>;
  }> {
    const flows = new Map<string, FlowDefinition>();
    const failures = new Map<string, Error>();
    const files = await fs.readdir(this.flowsDir);
    const jsonFiles = files.filter((f) => f.endsWith(".json") && f !== "flow-schema.json");

    logger.info("Loading all flows from directory", {
      dir: this.flowsDir,
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

    logger.info("All flows loaded", {
      loaded: flows.size,
      failed: failures.size,
    });
    return { flows, failures };
  }

  // ── Static: Structural validation ─────────────────────────

  /**
   * Validate a raw JSON value against the FlowDefinition TypeBox schema.
   *
   * @throws with human-readable error messages if validation fails.
   */
  static validateStructure(value: unknown): asserts value is FlowDefinition {
    if (!Value.Check(FlowDefinitionSchema, value)) {
      const errors = [...Value.Errors(FlowDefinitionSchema, value)].map(
        (e) => `  - ${e.instancePath}: ${e.message}`,
      );
      throw new Error(`Invalid flow definition:\n${errors.join("\n")}`);
    }
  }

  // ── Static: Semantic validation ───────────────────────────

  /**
   * Run semantic checks on a structurally-valid flow definition.
   *
   * Returns an array of error strings (empty = valid). The caller
   * decides whether to throw or accumulate.
   */
  static validateSemantics(flow: FlowDefinition, knownSpecs?: ReadonlySet<string>): string[] {
    const errors: string[] = [];

    // 1. No duplicate instruction ids
    errors.push(...FlowLoader.checkDuplicateIds(flow.steps));

    // 2. Walk the tree and check expressions + accumulateFrom + known specs
    FlowLoader.walkInstructions(flow.steps, [], errors, knownSpecs);

    return errors;
  }

  // ── Static private: Duplicate id detection ────────────────

  private static checkDuplicateIds(instructions: FlowInstruction[]): string[] {
    const seen = new Map<string, string>(); // id → first path
    const errors: string[] = [];

    FlowLoader.collectIds(instructions, "", seen, errors);
    return errors;
  }

  private static collectIds(
    instructions: FlowInstruction[],
    parentPath: string,
    seen: Map<string, string>,
    errors: string[],
  ): void {
    for (const instruction of instructions) {
      const instrPath = parentPath ? `${parentPath} → ${instruction.id}` : instruction.id;

      const firstPath = seen.get(instruction.id);
      if (firstPath !== undefined) {
        errors.push(
          `Duplicate instruction id "${instruction.id}" at "${instrPath}" ` +
            `(first seen at "${firstPath}")`,
        );
      } else {
        seen.set(instruction.id, instrPath);
      }

      // Recurse into children
      if (instruction.type === "parallel" || instruction.type === "loop") {
        FlowLoader.collectIds(containerSteps(instruction), instrPath, seen, errors);
      }
    }
  }

  // ── Static private: Tree walk for expression + accumulateFrom ─

  private static walkInstructions(
    instructions: FlowInstruction[],
    path: string[],
    errors: string[],
    knownSpecs?: ReadonlySet<string>,
  ): void {
    for (const instruction of instructions) {
      const currentPath = [...path, instruction.id];

      if (instruction.type === "agent" && knownSpecs && !knownSpecs.has(instruction.spec)) {
        errors.push(
          `Unknown spec "${instruction.spec}" referenced by agent "${currentPath.join(" → ")}"`,
        );
      }

      if (instruction.type === "loop") {
        FlowLoader.checkLoopExpression(instruction, currentPath, errors);
        FlowLoader.checkAccumulateFrom(instruction, currentPath, errors);
        FlowLoader.walkInstructions(containerSteps(instruction), currentPath, errors, knownSpecs);
      }

      if (instruction.type === "parallel") {
        FlowLoader.walkInstructions(containerSteps(instruction), currentPath, errors, knownSpecs);
      }
    }
  }

  private static checkLoopExpression(
    loop: Extract<FlowInstruction, { type: "loop" }>,
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
    loop: Extract<FlowInstruction, { type: "loop" }>,
    path: string[],
    errors: string[],
  ): void {
    if (!loop.accumulateFrom || loop.accumulateFrom.length === 0) return;

    // Collect all ids reachable within the loop body (recursive).
    // This allows accumulateFrom to reference ids inside nested
    // parallel/loop instructions (e.g. review inside parallel → review).
    const reachableIds = new Set<string>();
    FlowLoader.collectAllIds(containerSteps(loop as unknown as FlowInstruction), reachableIds);

    // Also collect all parseJson: true ids.
    const parseJsonIds = new Set<string>();
    FlowLoader.collectIdsByFlag(
      containerSteps(loop as unknown as FlowInstruction),
      "parseJson",
      parseJsonIds,
    );

    for (const targetId of loop.accumulateFrom) {
      if (!reachableIds.has(targetId)) {
        errors.push(
          `accumulateFrom references unknown id ` +
            `"${targetId}" in loop "${path.join(" → ")}" ` +
            `(not found in loop body)`,
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
      if (instruction.type === "parallel" || instruction.type === "loop") {
        FlowLoader.collectAllIds(containerSteps(instruction), ids);
      }
    }
  }

  /**
   * Collect ids of instructions where the given flag is true.
   * Walks recursively through parallel/loop containers.
   * Absent flag is treated as false.
   */
  private static collectIdsByFlag(
    instructions: FlowInstruction[],
    flag: "parseJson",
    ids: Set<string>,
  ): void {
    for (const instruction of instructions) {
      if (flag in instruction && instruction[flag] === true) {
        ids.add(instruction.id);
      }
      if (instruction.type === "parallel" || instruction.type === "loop") {
        FlowLoader.collectIdsByFlag(containerSteps(instruction), flag, ids);
      }
    }
  }
}
