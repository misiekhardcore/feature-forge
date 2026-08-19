import { fileURLToPath } from "node:url";

import { FlowContext } from "@feature-forge/core/src/flows/FlowContext";
import { FlowLoader } from "@feature-forge/core/src/flows/FlowLoader";
import { describe, expect, it } from "vitest";

/**
 * Verify that the production orchestrator system prompt resolves cleanly
 * through FlowContext.resolve() with no dead placeholders.
 *
 * The flow content lives in core at `src/flows/definitions/` (moved from
 * cli in S4f), so the fixture directory is resolved within the core package.
 */
const IMPLEMENT_FLOW_DIR = fileURLToPath(
  new URL("../flows/definitions/implement", import.meta.url),
);

describe("orchestrator system prompt", () => {
  it("fully resolves with no unresolved {{...}} tokens", async () => {
    const loader = new FlowLoader({ flowsDir: IMPLEMENT_FLOW_DIR });
    const flow = await loader.load("flow");

    const systemPrompt = flow.orchestrator?.systemPrompt;
    expect(systemPrompt?.length).toBeGreaterThan(0);

    const ctx = new FlowContext({
      results: new Map(),
      prompt: "Add user authentication",
    });
    const resolved = ctx.resolve(systemPrompt ?? "");

    // The resolved systemPrompt must not contain any {{...}} tokens.
    expect(resolved).not.toMatch(/\{\{/);
    expect(resolved).not.toMatch(/\}\}/);
  });

  it("contains no uppercase placeholder tokens in raw form", async () => {
    const loader = new FlowLoader({ flowsDir: IMPLEMENT_FLOW_DIR });
    const flow = await loader.load("flow");
    const systemPrompt = flow.orchestrator?.systemPrompt;

    // No {{CONTEXT}} or {{WORKSPACE}} or {{TASK}} should remain.
    expect(systemPrompt).not.toMatch(/\{\{CONTEXT\}\}/);
    expect(systemPrompt).not.toMatch(/\{\{WORKSPACE\}\}/);
    expect(systemPrompt).not.toMatch(/\{\{TASK\}\}/);
  });

  it("systemPrompt is a non-empty spec name (not a prompt string)", async () => {
    const loader = new FlowLoader({ flowsDir: IMPLEMENT_FLOW_DIR });
    const flow = await loader.load("flow");

    expect(flow.orchestrator?.systemPrompt).toBeTruthy();
    expect(flow.orchestrator?.systemPrompt.length).toBeGreaterThan(0);

    // systemPrompt is a spec name resolved through SpecManager — symmetric
    // with how flow agent steps reference sub-agent specs like "build".
    expect(flow.orchestrator?.systemPrompt).toBe("implement-orchestrator");
  });
});
