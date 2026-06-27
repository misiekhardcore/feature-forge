import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { FlowContext } from "./FlowContext";
import { FlowLoader } from "./FlowLoader";

/**
 * Verify that the production orchestrator prompt resolves cleanly
 * through FlowContext.resolve() with no dead placeholders.
 */
describe("orchestrator prompt", () => {
  it("fully resolves with no unresolved {{...}} tokens", async () => {
    const loader = new FlowLoader(path.join(__dirname, "..", "flows", "implement"));
    const flow = await loader.load("flow");

    const prompt = flow.orchestrator.prompt;
    expect(prompt.length).toBeGreaterThan(0);

    const ctx = new FlowContext(new Map(), "Add user authentication");
    const resolved = ctx.resolve(prompt);

    // The resolved prompt must not contain any {{...}} tokens.
    expect(resolved).not.toMatch(/\{\{/);
    expect(resolved).not.toMatch(/\}\}/);
  });

  it("contains no uppercase placeholder tokens in raw form", async () => {
    const loader = new FlowLoader(path.join(__dirname, "..", "flows", "implement"));
    const flow = await loader.load("flow");
    const prompt = flow.orchestrator.prompt;

    // No {{CONTEXT}} or {{WORKSPACE}} or {{TASK}} should remain in the production flow text.
    expect(prompt).not.toMatch(/\{\{CONTEXT\}\}/);
    expect(prompt).not.toMatch(/\{\{WORKSPACE\}\}/);
    expect(prompt).not.toMatch(/\{\{TASK\}\}/);
  });

  it("prompt is non-empty and valid", async () => {
    const loader = new FlowLoader(path.join(__dirname, "..", "flows", "implement"));
    const flow = await loader.load("flow");

    expect(flow.orchestrator.prompt).toBeTruthy();
    expect(flow.orchestrator.prompt.length).toBeGreaterThan(0);

    // Verify activeTools is present
    expect(flow.orchestrator.activeTools).toBeDefined();
    expect(flow.orchestrator.activeTools!.length).toBeGreaterThan(0);
  });
});
