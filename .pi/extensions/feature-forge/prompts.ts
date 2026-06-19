import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const promptsDir = join(fileURLToPath(import.meta.url), "..", "prompts");

function load(name: string, variables?: Record<string, string>): string {
  let content = readFileSync(join(promptsDir, `${name}.md`), "utf-8").trim();
  if (variables) {
    for (const [key, value] of Object.entries(variables)) {
      content = content.replaceAll(`{{${key}}}`, value);
    }
  }
  return content;
}

export const DISCOVERY_PROMPT = load("discover");
export const DEFINE_PROMPT = load("define");

export function researchPrompt(issueUrl: string): string {
  return load("research", { issueUrl });
}

export const IMPLEMENT_PROMPTS = {
  coordinator: load("implement-coordinator"),
  build: load("implement-build"),
  review: load("implement-review"),
  verify: load("implement-verify"),
  pr: load("implement-pr"),
} as const;
