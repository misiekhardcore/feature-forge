import * as fs from "node:fs/promises";
import * as path from "node:path";

import { jsonParse } from "@feature-forge/shared";
import { logger } from "@feature-forge/shared";

import type { FlowDefinition } from "./FlowInstruction";
import { FlowValidation } from "./flowValidation";

/**
 * Discover flow subdirectories in a flows root (`src/flows/<name>/flow.json`
 * layout). Returns directory names in readdir order; non-directories (e.g.
 * the root-level `flow-schema.json`) are skipped. Missing/unreadable roots
 * yield an empty list.
 */
export async function discoverFlowDirectories(flowsDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(flowsDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Loads and validates declarative routine-based flow JSON files.
 *
 * I/O and loading only; the structural and semantic validation rules live in
 * the `FlowValidation` static class in `flowValidation.ts`.
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
      FlowValidation.validateStructure(parsed);
    } catch (error) {
      logger.error("Flow structural validation failed", { name, error: (error as Error).message });
      throw error;
    }

    const semanticErrors = FlowValidation.validateSemantics(
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
    // Flows live in subdirectories (src/flows/<name>/flow.json); a flat
    // `*.json` scan no longer matches the layout.
    const dirs = await discoverFlowDirectories(this.params.flowsDir);

    logger.info("Loading all flows from directory", {
      dir: this.params.flowsDir,
      count: dirs.length,
    });

    for (const dir of dirs) {
      try {
        flows.set(dir, await this.load(path.join(dir, "flow")));
      } catch (error) {
        logger.warn("Skipping invalid flow", { name: dir, error: (error as Error).message });
        failures.set(dir, error instanceof Error ? error : new Error(String(error)));
      }
    }

    logger.info("All flows loaded", { loaded: flows.size, failed: failures.size });
    return { flows, failures };
  }
}
