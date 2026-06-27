import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { FlowLoader } from "../src/orchestrator/FlowLoader";

/**
 * Validate a flow package against the structural and semantic rules.
 *
 * Usage: npx tsx scripts/validate-flow.ts <path-to-flow-package-dir>
 *        npx tsx scripts/validate-flow.ts --all
 *
 * A flow package is a directory containing flow.json.
 */

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: npm run flow:validate -- <path-to-flow-package-dir>");
    console.error("       npm run flow:validate -- --all");
    process.exit(1);
  }

  if (args[0] === "--all") {
    const flowsDir = path.join(scriptDir, "..", "src", "flows");
    const loader = new FlowLoader(flowsDir);
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

  const pkgDir = path.resolve(args[0]);

  // Validate the flow package
  const flowsDir = path.dirname(pkgDir);
  const pkgName = path.basename(pkgDir);
  const loader = new FlowLoader(flowsDir);

  try {
    const flow = await loader.load(pkgName);
    console.log(`✓ Flow "${flow.name}" is valid`);
  } catch (cause) {
    console.error(`✗ ${(cause as Error).message}`);
    process.exit(1);
  }
}

void main();
