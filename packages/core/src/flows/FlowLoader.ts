import * as fs from "node:fs/promises";
import * as path from "node:path";

import { jsonParse } from "../helpers";
import { logger } from "../logging";
import type { FlowDefinition } from "./FlowInstruction";
import { FLOW_SCHEMA_URL, LEGACY_FLOW_SCHEMA_URLS } from "./FlowInstruction";
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

    // One-shot auto-migration: a known legacy $schema URL is rewritten to
    // the current location (in memory always, file write best-effort). Runs
    // after parsing so a file that is not valid JSON is never rewritten.
    // Unknown/missing URLs are left untouched so validation still rejects
    // them loudly.
    parsed = await this.migrateSchemaUrl(raw, parsed, filepath, name);

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

  /**
   * One-shot `$schema` auto-migration. When the flow's `$schema` value is
   * one of the known legacy URLs, it is pointed at the current
   * {@link FLOW_SCHEMA_URL} in memory and, best-effort, on disk. Only the
   * `$schema` member in the raw text is rewritten (a legacy URL inside any
   * other string, e.g. prose in a prompt, is preserved) and the write is
   * atomic (temp file + rename). A failed write leaves the file stale and
   * is reported via a warning, never an error; the in-memory migration
   * always succeeds.
   */
  private async migrateSchemaUrl(
    raw: string,
    parsed: unknown,
    filepath: string,
    name: string,
  ): Promise<unknown> {
    if (typeof parsed !== "object" || parsed === null || !("$schema" in parsed)) {
      // Missing $schema - left for validation to reject loudly.
      return parsed;
    }
    const schemaUrl = parsed.$schema;
    if (typeof schemaUrl !== "string" || !LEGACY_FLOW_SCHEMA_URLS.includes(schemaUrl)) {
      // Current or unknown $schema - untouched.
      return parsed;
    }

    parsed.$schema = FLOW_SCHEMA_URL;

    // Rewrite the URL only where it is the value of a "$schema" member,
    // so a legacy URL appearing in any other string is preserved. The
    // exact-match `includes` above keeps this to a single legacy URL, so
    // overlapping future entries cannot double-replace. A
    // `\u0024schema`-escaped key is valid JSON but is not matched here;
    // the guard below then skips the write while the in-memory migration
    // stands.
    const schemaMember = new RegExp(`("\\$schema"\\s*:\\s*")${escapeRegExp(schemaUrl)}(")`, "g");
    const next = raw.replace(schemaMember, `$1${FLOW_SCHEMA_URL}$2`);
    if (next === raw) {
      return parsed;
    }

    const tmpPath = `${filepath}.${process.pid}.tmp`;
    try {
      await fs.writeFile(tmpPath, next, "utf-8");
      await fs.rename(tmpPath, filepath);
      logger.warn("Flow $schema auto-migrated to current URL", { name, filepath });
    } catch (error) {
      await fs.rm(tmpPath, { force: true }).catch(() => {});
      logger.warn("Flow $schema auto-migration write failed (file left stale)", {
        name,
        filepath,
        error,
      });
    }
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

/**
 * Escape a literal string for safe interpolation into a RegExp source.
 */
function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
