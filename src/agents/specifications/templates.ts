import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROMPT_DIR = join(__dirname, "..", "prompts");

const promptCache = new Map<string, string>();

/**
 * Read a prompt file by name (without extension).
 *
 * The file is loaded synchronously at first call and cached in memory
 * for subsequent access.
 *
 * @param name — stem of the file, e.g. `"research"` loads `prompts/research.md`.
 * @returns The raw template text.
 */
export function loadPromptTemplate(name: string, values?: Record<string, string>): string {
  console.log(`Loading prompt template: ${name}`, values);
  const cached = promptCache.get(name);
  if (cached !== undefined) {
    return fillTemplate(cached, values);
  }
  const path = join(PROMPT_DIR, `${name}.md`);
  const content = readFileSync(path, "utf-8");
  promptCache.set(name, content);
  return fillTemplate(content, values);
}

/**
 * Replace `{{PLACEHOLDER}}` tokens in a template with provided values.
 *
 * Unknown tokens (present in the template but absent from `values`)
 * are left as-is rather than silently removed.
 */
export function fillTemplate(template: string, values?: Record<string, string>): string {
  let result = template;
  if (values) {
    for (const [key, value] of Object.entries(values)) {
      result = result.replaceAll(`{{${key}}}`, value);
    }
  }
  console.log("Filled template:", result);
  return result;
}
