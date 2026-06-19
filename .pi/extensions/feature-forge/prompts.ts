import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const promptsDir = join(fileURLToPath(import.meta.url), "..", "prompts");

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function load(name: string, variables?: Record<string, string>): string {
  let content = readFileSync(join(promptsDir, `${name}.md`), "utf-8").trim();
  if (variables) {
    for (const [key, value] of Object.entries(variables)) {
      content = content.replace(new RegExp(`\\{\\{${escapeRegExp(key)}\\}\}`, "g"), value);
    }
  }
  return content;
}

export const DISCOVERY_PROMPT = load("discover");
export const DEFINE_PROMPT = load("define");

export function researchPrompt(issueUrl: string): string {
  return load("research", { issueUrl });
}
