import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { jsonParse } from "../src/helpers";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
// Script lives in core/scripts; flows are core-owned.
const coreDir = path.join(scriptDir, "..");
const coreFlowsDir = path.join(coreDir, "src", "flows");

const schemaPath = path.join(coreFlowsDir, "flow-schema.json");
const flowJsonPattern = path.join(coreFlowsDir, "definitions", "**", "flow.json");

const schemaRaw = fs.readFileSync(schemaPath, "utf-8");
const schema: Record<string, unknown> = jsonParse<Record<string, unknown>>(schemaRaw);

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

const validateFunction = ajv.compile(schema);

const flowFiles = fs.globSync(flowJsonPattern);

let hasErrors = false;

for (const filePath of flowFiles) {
  const dataRaw = fs.readFileSync(filePath, "utf-8");
  const data: Record<string, unknown> = jsonParse<Record<string, unknown>>(dataRaw);
  const valid = validateFunction(data);
  const relativePath = path.relative(coreDir, filePath);

  if (valid) {
    console.log(`✓ ${relativePath}`);
  } else {
    hasErrors = true;
    console.error(`✗ ${relativePath}`);
    for (const error of validateFunction.errors ?? []) {
      console.error(`  ${error.instancePath}: ${error.message}`);
    }
  }
}

if (hasErrors) {
  process.exit(1);
}

console.log("All flow files are valid.");
