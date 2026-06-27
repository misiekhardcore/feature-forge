import * as fs from "node:fs/promises";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { FlowContext } from "./FlowContext";
import { FlowLoader } from "./FlowLoader";

/**
 * Verify that the production orchestrator prompt resolves cleanly
 * through FlowContext.resolve() with no dead placeholders and correct
 * {{task}} substitution.
 *
 * In the routine-package form, orchestrator.prompt is a filename
 * (relative to the flow package directory), not inline markdown.
 * The test reads the .md file, resolves it through FlowContext,
 * and asserts no unresolved {{...}} survivors.
 */
describe("orchestrator prompt", () => {
  const flowsDir = path.join(__dirname, "..", "flows");

  it("fully resolves with no unresolved {{...}} tokens", async () => {
    const loader = new FlowLoader(flowsDir);
    const flow = await loader.load("implement");

    // orchestrator.prompt is a filename like "orchestrator.md"
    const promptFile = flow.orchestrator.prompt;
    expect(promptFile.length).toBeGreaterThan(0);

    // Read the actual markdown file from the flow package
    const mdPath = path.join(flowsDir, "implement", promptFile);
    const promptText = await fs.readFile(mdPath, "utf-8");
    expect(promptText.length).toBeGreaterThan(0);

    const ctx = new FlowContext(new Map(), "Add user authentication", "");
    const resolved = ctx.resolve(promptText);

    // The resolved prompt must not contain any {{...}} tokens.
    expect(resolved).not.toMatch(/\{\{/);
    expect(resolved).not.toMatch(/\}\}/);

    // {{task}} must be substituted.
    expect(resolved).not.toContain("{{task}}");
    expect(resolved).toContain("Add user authentication");
  });

  it("contains no uppercase placeholder tokens in raw form", async () => {
    const loader = new FlowLoader(flowsDir);
    const flow = await loader.load("implement");

    const mdPath = path.join(flowsDir, "implement", flow.orchestrator.prompt);
    const promptText = await fs.readFile(mdPath, "utf-8");

    // No {{CONTEXT}} or {{WORKSPACE}} should remain in the production flow text.
    expect(promptText).not.toMatch(/\{\{CONTEXT\}\}/);
    expect(promptText).not.toMatch(/\{\{WORKSPACE\}\}/);
    expect(promptText).not.toMatch(/\{\{TASK\}\}/);
  });

  it("resolves only {{task}} via FlowContext when plan is empty", async () => {
    const loader = new FlowLoader(flowsDir);
    const flow = await loader.load("implement");

    const mdPath = path.join(flowsDir, "implement", flow.orchestrator.prompt);
    const promptText = await fs.readFile(mdPath, "utf-8");

    const ctx = new FlowContext(new Map(), "Fix login bug", "");
    const resolved = ctx.resolve(promptText);

    // {{task}} → "Fix login bug"
    expect(resolved).toContain("Fix login bug");
    // No other FlowContext placeholders should appear in the prompt.
    // ({{plan}}, {{feedback}}, {{workspace}} are not used in orchestrator.md)
    expect(resolved).not.toContain("{{plan}}");
    expect(resolved).not.toContain("{{feedback}}");
    expect(resolved).not.toContain("{{workspace}}");
  });
});
