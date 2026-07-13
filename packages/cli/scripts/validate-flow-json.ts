import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { jsonParse } from "@feature-forge/shared";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(scriptDir, "..");

const schemaPath = path.join(rootDir, "src", "flows", "flow-schema.json");
const flowJsonPattern = path.join(rootDir, "src", "flows", "**", "flow.json");

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
  const relativePath = path.relative(rootDir, filePath);

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
