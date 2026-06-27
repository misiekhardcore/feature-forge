import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { FlowContext } from "./FlowContext";
import { FlowLoader } from "./FlowLoader";

/**
 * Verify that the production orchestrator prompt resolves cleanly
 * through FlowContext.resolve() with no dead placeholders and correct
 * {{task}} substitution.
 */
describe("orchestrator prompt", () => {
  it("fully resolves with no unresolved {{...}} tokens", async () => {
    const loader = new FlowLoader(path.join(__dirname, "..", "flows"));
    const flow = await loader.load("implement");

    const prompt = flow.orchestrator.task;
    expect(prompt.length).toBeGreaterThan(0);

    const ctx = new FlowContext(new Map(), "Add user authentication", "");
    const resolved = ctx.resolve(prompt);

    // The resolved prompt must not contain any {{...}} tokens.
    expect(resolved).not.toMatch(/\{\{/);
    expect(resolved).not.toMatch(/\}\}/);

    // {{task}} must be substituted.
    expect(resolved).not.toContain("{{task}}");
    expect(resolved).toContain("Add user authentication");
  });

  it("contains no uppercase placeholder tokens in raw form", async () => {
    const loader = new FlowLoader(path.join(__dirname, "..", "flows"));
    const flow = await loader.load("implement");
    const prompt = flow.orchestrator.task;

    // No {{CONTEXT}} or {{WORKSPACE}} should remain in the production flow text.
    expect(prompt).not.toMatch(/\{\{CONTEXT\}\}/);
    expect(prompt).not.toMatch(/\{\{WORKSPACE\}\}/);
    expect(prompt).not.toMatch(/\{\{TASK\}\}/);
  });

  it("resolves only {{task}} via FlowContext when plan is empty", async () => {
    const loader = new FlowLoader(path.join(__dirname, "..", "flows"));
    const flow = await loader.load("implement");

    const ctx = new FlowContext(new Map(), "Fix login bug", "");
    const resolved = ctx.resolve(flow.orchestrator.task);

    // {{task}} → "Fix login bug"
    expect(resolved).toContain("Fix login bug");
    // No other FlowContext placeholders should appear in the prompt.
    // ({{plan}}, {{feedback}}, {{workspace}} are not used in orchestrator.task)
    expect(resolved).not.toContain("{{plan}}");
    expect(resolved).not.toContain("{{feedback}}");
    expect(resolved).not.toContain("{{workspace}}");
  });
});
