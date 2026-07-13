import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { jsonParse } from "@feature-forge/shared";

import { FlowLoader } from "../src/orchestrator/FlowLoader";

/**
 * Validate a flow JSON file against the structural and semantic rules.
 *
 * Usage: npx tsx scripts/validate-flow.ts <path-to-flow.json>
 */

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: npm run flow:validate -- <path-to-flow.json>");
    console.error("       npm run flow:validate --all");
    process.exit(1);
  }

  if (args[0] === "--all") {
    const flowsDir = path.join(scriptDir, "..", "src", "flows");
    const loader = new FlowLoader({ flowsDir });
    const { flows, failures } = await loader.loadAll();

    if (failures.size > 0) {
      console.error(`✗ ${failures.size} flow(s) failed validation:`);
      for (const [name, error] of failures) {
        console.error(`  - ${name}: ${error.message}`);
      }
    }

    if (flows.size === 0) {
      console.log("No valid flows found.");
      return;
    }

    console.log(`✓ ${flows.size} flow(s) valid:`);
    for (const name of flows.keys()) {
      console.log(`  - ${name}`);
    }

    if (failures.size > 0) {
      process.exit(1);
    }
    return;
  }

  const filepath = path.resolve(args[0]);

  // Read and parse JSON
  let raw: string;
  try {
    const { readFile } = await import("node:fs/promises");
    raw = await readFile(filepath, "utf-8");
  } catch {
    console.error(`✗ File not found: ${filepath}`);
    process.exit(1);
  }

  let json: unknown;
  try {
    json = jsonParse(raw);
  } catch (cause) {
    console.error(`✗ Invalid JSON: ${(cause as Error).message}`);
    process.exit(1);
  }

  // Structural validation
  try {
    FlowLoader.validateStructure(json);
  } catch (cause) {
    console.error(`✗ Structural validation failed:\n${(cause as Error).message}`);
    process.exit(1);
  }

  // Semantic validation
  const errors = FlowLoader.validateSemantics(json);
  if (errors.length > 0) {
    console.error(`✗ Semantic validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
    process.exit(1);
  }

  console.log(`✓ Flow "${json.name}" is valid`);
}

void main();
