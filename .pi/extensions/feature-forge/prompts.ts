import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const promptsDir = join(fileURLToPath(import.meta.url), "..", "prompts");

function load(name: string): string {
  return readFileSync(join(promptsDir, `${name}.md`), "utf-8").trim();
}

export const DISCOVERY_PROMPT = load("discover");
