import * as fs from "node:fs/promises";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FlowDefinition } from "../../orchestrator/FlowInstruction";
import { DynamicAgentSpecification } from "../specifications";
import { FlowSpecLoader } from "./FlowSpecLoader";

// ── Helpers ──────────────────────────────────────────────────

function makeFlow(overrides: { systemPrompt?: string } = {}): FlowDefinition {
  return {
    name: "test",
    command: "/test",
    orchestrator: {
      systemPrompt: overrides.systemPrompt ?? "orchestrator.md",
    },
    routines: {},
  };
}

async function writeOrchestratorMd(dir: string, content: string): Promise<void> {
  await fs.writeFile(path.join(dir, "orchestrator.md"), content);
}

describe("FlowSpecLoader", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp("/tmp/flow-spec-loader-test-");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("reads orchestrator markdown and extracts persona and tools into a spec", async () => {
    await writeOrchestratorMd(
      tempDir,
      "---\nid: test\nrole: orchestrator\ntools:\n  - tool_a\n  - tool_b\n---\n\n# Persona\n\nBe helpful.",
    );

    const spec = await FlowSpecLoader.load(makeFlow(), tempDir);

    expect(spec).toBeInstanceOf(DynamicAgentSpecification);
    expect(spec.id).toBe("test");
    expect(spec.role).toBe("orchestrator");
    expect(spec.systemPrompt).toBe("# Persona\n\nBe helpful.");
    expect([...spec.tools]).toEqual(["tool_a", "tool_b"]);
  });

  it("defaults the role to 'orchestrator' when frontmatter omits it", async () => {
    await writeOrchestratorMd(tempDir, "# Just a title\n\nNo frontmatter.");

    const spec = await FlowSpecLoader.load(makeFlow(), tempDir);

    expect(spec.role).toBe("orchestrator");
    expect(spec.systemPrompt).toBe("# Just a title\n\nNo frontmatter.");
    expect([...spec.tools]).toEqual([]);
  });

  it("generates a role-based id when frontmatter omits an explicit id", async () => {
    await writeOrchestratorMd(tempDir, "---\nrole: researcher\n---\n\nBody.");

    const spec = await FlowSpecLoader.load(makeFlow(), tempDir);

    expect(spec.id).toMatch(/^researcher-/);
    expect(spec.systemPrompt).toBe("Body.");
  });

  it("uses an explicit frontmatter id verbatim", async () => {
    await writeOrchestratorMd(
      tempDir,
      "---\nid: my-orchestrator\nrole: orchestrator\n---\n\nBody.",
    );

    const spec = await FlowSpecLoader.load(makeFlow(), tempDir);

    expect(spec.id).toBe("my-orchestrator");
  });

  it("handles an empty tools array", async () => {
    await writeOrchestratorMd(tempDir, "---\nid: test\ntools: []\n---\n\nBody.");

    const spec = await FlowSpecLoader.load(makeFlow(), tempDir);

    expect([...spec.tools]).toEqual([]);
    expect(spec.systemPrompt).toBe("Body.");
  });
});
