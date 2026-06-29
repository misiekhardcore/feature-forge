import { describe, expect, it, vi } from "vitest";

import { InMemoryAgentSupervisor } from "../agents/supervisors/InMemoryAgentSupervisor";
import { makeMockFactory, makeMockSpecManager, MockAgent } from "../test-utils";
import { AgentStepExecutor } from "./AgentStepExecutor";
import { FlowContext } from "./FlowContext";
import type { AgentInstruction } from "./FlowInstruction";

function makeAgentInstruction(overrides: Partial<AgentInstruction> = {}): AgentInstruction {
  return {
    type: "agent",
    id: "builder",
    spec: "build",
    task: "Build: {{task}}",
    parseJson: true,
    ...overrides,
  } as AgentInstruction;
}

describe("AgentStepExecutor", () => {
  describe("type", () => {
    it("returns 'agent'", () => {
      const executor = new AgentStepExecutor(
        new InMemoryAgentSupervisor(makeMockFactory()),
        makeMockSpecManager(),
      );
      expect(executor.type).toBe("agent");
    });
  });

  describe("execute", () => {
    it("spawns an agent with the resolved spec, executes the task, and stores the result", async () => {
      const factory = makeMockFactory();
      const supervisor = new InMemoryAgentSupervisor(factory);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction = makeAgentInstruction({
        id: "builder",
        task: "Write tests for {{task}}",
      });
      const context = new FlowContext(new Map(), "add auth", "");

      const next = await executor.execute(instruction, context, async () => context);

      const result = next.results.get("builder");
      expect(result).toBeDefined();
      expect(result!.raw).toContain("Write tests for add auth");
      expect(result!.parsed).toBeUndefined();
    });

    it("resolves workingDir when set to 'workspace'", async () => {
      const factory = makeMockFactory();
      const supervisor = new InMemoryAgentSupervisor(factory);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction = makeAgentInstruction({
        workingDir: "workspace",
      });
      const context = new FlowContext(new Map(), "task", "", "/tmp/ws", undefined, "ws1");

      await executor.execute(instruction, context, async () => context);

      const createdSpec = specManager.resolve({ spec: "build", toolNames: [] });
      expect(createdSpec).toBeDefined();
    });

    it("resolves workingDir template when set to a string path", async () => {
      const factory = makeMockFactory();
      const supervisor = new InMemoryAgentSupervisor(factory);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction = makeAgentInstruction({
        workingDir: "{{workspace}}/subdir",
      });
      const context = new FlowContext(new Map(), "task", "", "/tmp/ws", undefined, "ws1");

      await executor.execute(instruction, context, async () => context);

      expect(specManager.resolve).toHaveBeenCalled();
    });

    it("extracts JSON when parseJson is true and a json block is present", async () => {
      const jsonAgent = new MockAgent("builder");
      jsonAgent.executeTask = vi
        .fn()
        .mockResolvedValue('Done.\n```json\n{"kind":"build","passed":true,"summary":"ok"}\n```');

      const factory = {
        create: vi.fn().mockResolvedValue(jsonAgent),
      };
      const supervisor = new InMemoryAgentSupervisor(factory);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction = makeAgentInstruction({ parseJson: true });
      const context = new FlowContext(new Map(), "task", "");

      const next = await executor.execute(instruction, context, async () => context);

      const result = next.results.get("builder");
      expect(result!.parsed).toEqual({ kind: "build", passed: true, summary: "ok" });
    });

    it("does not extract JSON when parseJson is false", async () => {
      const factory = makeMockFactory();
      const supervisor = new InMemoryAgentSupervisor(factory);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction = makeAgentInstruction({ parseJson: false });
      const context = new FlowContext(new Map(), "task", "");

      const next = await executor.execute(instruction, context, async () => context);

      const result = next.results.get("builder");
      expect(result!.parsed).toBeUndefined();
    });

    it("resolves specInput values through context and passes them as specParams", async () => {
      const factory = makeMockFactory();
      const supervisor = new InMemoryAgentSupervisor(factory);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction = makeAgentInstruction({
        id: "builder",
        task: "Build",
        specInput: {
          TASK: "{{task}}",
          WORKSPACE: "{{workspace}}",
          FEEDBACK: "{{feedback}}",
          CONTEXT: "Context: {{task}}",
        },
      });
      const context = new FlowContext(new Map(), "add auth", "", "/tmp/ws", "prior findings");

      await executor.execute(instruction, context, async () => context);

      expect(specManager.resolve).toHaveBeenCalledWith(
        expect.objectContaining({
          specParams: {
            TASK: "add auth",
            WORKSPACE: "/tmp/ws",
            FEEDBACK: "prior findings",
            CONTEXT: "Context: add auth",
          },
        }),
      );
    });

    it("uses resolved defaults when specInput is absent", async () => {
      const factory = makeMockFactory();
      const supervisor = new InMemoryAgentSupervisor(factory);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction = makeAgentInstruction({
        id: "builder",
        task: "Do {{task}}",
      });
      const context = new FlowContext(new Map(), "add auth", "the plan");

      await executor.execute(instruction, context, async () => context);

      expect(specManager.resolve).toHaveBeenCalledWith(
        expect.objectContaining({
          specParams: {
            TASK: "Do add auth",
            WORKSPACE: "",
            FEEDBACK: "",
            CONTEXT: "add auth\nthe plan",
          },
        }),
      );
    });

    it("destroys the agent after execution", async () => {
      const agent = new MockAgent("builder");
      const destroySpy = vi.spyOn(agent, "destroy");
      const factory = {
        create: vi.fn().mockResolvedValue(agent),
      };

      const supervisor = new InMemoryAgentSupervisor(factory);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction = makeAgentInstruction();
      const context = new FlowContext(new Map(), "task", "");

      await executor.execute(instruction, context, async () => context);

      expect(destroySpy).toHaveBeenCalled();
    });
  });
});
