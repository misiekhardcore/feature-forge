import * as fs from "node:fs/promises";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FlowContext } from "../../orchestrator/FlowContext";
import type { FlowDefinition } from "../../orchestrator/FlowInstruction";
import { makeMockPi } from "../../test-utils";
import { OrchestratorAgent } from "./OrchestratorAgent";

// ── Helpers ──────────────────────────────────────────────────

function makeFlow(
  overrides: {
    systemPrompt?: string;
    prompt?: string;
    promptParams?: Record<string, string>;
  } = {},
): FlowDefinition {
  return {
    name: "test",
    command: "/test",
    orchestrator: {
      systemPrompt: overrides.systemPrompt ?? "orchestrator.md",
      ...(overrides.prompt !== undefined ? { prompt: overrides.prompt } : {}),
      ...(overrides.promptParams !== undefined ? { promptParams: overrides.promptParams } : {}),
    },
    routines: {},
  };
}

async function writeOrchestratorMd(dir: string, content: string): Promise<void> {
  await fs.writeFile(path.join(dir, "orchestrator.md"), content);
}

describe("OrchestratorAgent", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp("/tmp/orchestrator-agent-test-");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("create", () => {
    it("reads orchestrator markdown and extracts persona and tools", async () => {
      await writeOrchestratorMd(
        tempDir,
        "---\nid: test\nrole: orchestrator\ntools:\n  - tool_a\n  - tool_b\n---\n\n# Persona\n\nBe helpful.",
      );

      const flow = makeFlow();
      const agent = await OrchestratorAgent.create(flow, tempDir);

      expect(agent.systemPrompt).toBe("# Persona\n\nBe helpful.");
      expect(agent.tools).toEqual(["tool_a", "tool_b"]);
    });

    it("handles missing frontmatter fields gracefully", async () => {
      await writeOrchestratorMd(tempDir, "# Just a title\n\nNo frontmatter.");

      const flow = makeFlow();
      const agent = await OrchestratorAgent.create(flow, tempDir);

      expect(agent.systemPrompt).toBe("# Just a title\n\nNo frontmatter.");
      expect(agent.tools).toBeUndefined();
    });

    it("handles empty tools", async () => {
      await writeOrchestratorMd(tempDir, "---\nid: test\ntools: []\n---\n\nBody.");

      const flow = makeFlow();
      const agent = await OrchestratorAgent.create(flow, tempDir);

      expect(agent.systemPrompt).toBe("Body.");
      expect(agent.tools).toEqual([]);
    });

    it("stores task template from flow.orchestrator.task", async () => {
      await writeOrchestratorMd(tempDir, "---\n---\n\nPersona content.");

      const flow = makeFlow({ prompt: "{{prompt}}" });
      const agent = await OrchestratorAgent.create(flow, tempDir);

      // Task template is stored internally — verify through mount behaviour
      const pi = makeMockPi();
      const ctx = new FlowContext(new Map(), "fix bug");
      agent.mount(pi, ctx);

      expect(pi.sendUserMessage).toHaveBeenCalled();
      const sentMessage = (pi.sendUserMessage as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(sentMessage).toContain("Persona content.");
      expect(sentMessage).toContain("fix bug");
      expect(sentMessage).not.toContain("{{prompt}}");
    });
  });

  describe("mount", () => {
    it("sends system prompt and resolved prompt as user message", async () => {
      await writeOrchestratorMd(tempDir, "# Orchestrator\n\nYou are helpful.");

      const flow = makeFlow({ prompt: "Build: {{prompt}}" });
      const agent = await OrchestratorAgent.create(flow, tempDir);

      const pi = makeMockPi();
      const ctx = new FlowContext(new Map(), "add auth");
      agent.mount(pi, ctx);

      expect(pi.sendUserMessage).toHaveBeenCalledOnce();
      const message = (pi.sendUserMessage as unknown as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as string;
      expect(message).toContain("You are helpful.");
      expect(message).toContain("Build: add auth");
    });

    it("sets active tools when declared in frontmatter", async () => {
      await writeOrchestratorMd(tempDir, "---\ntools:\n  - routine_x\n  - bash\n---\n\nPersona.");

      const flow = makeFlow();
      const agent = await OrchestratorAgent.create(flow, tempDir);

      const pi = makeMockPi();
      const ctx = new FlowContext(new Map(), "task");
      agent.mount(pi, ctx);

      expect(pi.setActiveTools).toHaveBeenCalledWith(["routine_x", "bash"]);
    });

    it("does not call setActiveTools when frontmatter has no tools", async () => {
      await writeOrchestratorMd(tempDir, "---\nid: test\n---\n\nPersona.");

      const flow = makeFlow();
      const agent = await OrchestratorAgent.create(flow, tempDir);

      const pi = makeMockPi();
      const ctx = new FlowContext(new Map(), "task");
      agent.mount(pi, ctx);

      expect(pi.setActiveTools).not.toHaveBeenCalled();
    });

    it("does not call setActiveTools when tools is empty", async () => {
      await writeOrchestratorMd(tempDir, "---\ntools: []\n---\n\nPersona.");

      const flow = makeFlow();
      const agent = await OrchestratorAgent.create(flow, tempDir);

      const pi = makeMockPi();
      const ctx = new FlowContext(new Map(), "task");
      agent.mount(pi, ctx);

      expect(pi.setActiveTools).not.toHaveBeenCalled();
    });

    it("uses empty string when flow has no task", async () => {
      await writeOrchestratorMd(tempDir, "---\n---\n\nPersona without task.");

      const flow = makeFlow(); // no task
      const agent = await OrchestratorAgent.create(flow, tempDir);

      const pi = makeMockPi();
      const ctx = new FlowContext(new Map(), "unused");
      agent.mount(pi, ctx);

      const message = (pi.on as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
      console.log((pi.on as unknown as ReturnType<typeof vi.fn>).mock.calls);
      expect(message).toContain("Persona without task.");
    });
  });
});
