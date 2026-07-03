import { describe, expect, it, vi } from "vitest";

import type { SubprocessAgent } from "../../agents/agents/SubprocessAgent";
import type { AgentSpecification } from "../../agents/specifications/AgentSpecification";
import type { SpecManager } from "../../agents/SpecManager";
import type { AgentSupervisor } from "../../agents/supervisors/AgentSupervisor";
import { WorkspaceHandle } from "../../workspace/WorkspaceHandle";
import { FlowContext } from "../FlowContext";
import type { AgentInstruction } from "../FlowInstruction";
import { AgentInstructionWorkingDirMissing } from "./AgentInstructionWorkingDirMissing";
import { AgentStepExecutor } from "./AgentStepExecutor";

// ── Helpers ──────────────────────────────────────────────────

function makeMockSpecManager(): SpecManager {
  return {
    createDynamic: vi.fn().mockImplementation((spec: AgentSpecification) => spec),
    resolve: vi.fn().mockReturnValue({
      id: "test-agent",
      role: "test",
      systemPrompt: "prompt",
      tools: [],
    } as unknown as AgentSpecification),
  } as unknown as SpecManager;
}

function makeMockAgent(result: string): SubprocessAgent {
  return {
    id: "test-agent",
    executeTask: vi.fn().mockResolvedValue(result),
    getResult: vi.fn().mockReturnValue(result),
    destroy: vi.fn().mockResolvedValue(undefined),
  } as unknown as SubprocessAgent;
}

function makeMockAgentThatThrows(error: Error): SubprocessAgent {
  return {
    id: "test-agent",
    executeTask: vi.fn().mockRejectedValue(error),
    destroy: vi.fn().mockResolvedValue(undefined),
  } as unknown as SubprocessAgent;
}

function makeMockSupervisor(agent: SubprocessAgent): AgentSupervisor {
  return {
    spawnGuest: vi.fn().mockResolvedValue(agent),
    destroyAgent: vi.fn().mockResolvedValue(undefined),
  } as unknown as AgentSupervisor;
}

// ── Tests ────────────────────────────────────────────────────

describe("AgentStepExecutor", () => {
  describe("execute", () => {
    it("spawns an agent, executes task, collects result, and destroys", async () => {
      const agent = makeMockAgent("build output");
      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "builder",
        systemPrompt: "build",
        prompt: "do the thing",
      };
      const context = new FlowContext(new Map(), "task");

      const result = await executor.execute(instruction, context, vi.fn());

      expect(specManager.resolve).toHaveBeenCalled();
      expect(supervisor.spawnGuest).toHaveBeenCalled();
      expect(agent.executeTask).toHaveBeenCalledWith("do the thing");
      expect(agent.getResult).toHaveBeenCalled();
      expect(supervisor.destroyAgent).toHaveBeenCalledWith(agent.id);

      expect(result.results.get("builder")!.raw).toBe("build output");
    });

    it("resolves placeholders in the task template", async () => {
      const agent = makeMockAgent("done");
      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "builder",
        systemPrompt: "build",
        prompt: "do {{prompt}}",
      };
      const context = new FlowContext(new Map(), "add auth");

      await executor.execute(instruction, context, vi.fn());

      expect(agent.executeTask).toHaveBeenCalledWith("do add auth");
    });

    it("parses JSON output when parseJson is true", async () => {
      const agent = makeMockAgent('```json\n{"passed": true, "summary": "all good"}\n```');
      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "builder",
        systemPrompt: "build",
        prompt: "build",
        parseJson: true,
      };
      const context = new FlowContext(new Map(), "task");

      const result = await executor.execute(instruction, context, vi.fn());

      expect(result.results.get("builder")!.parsed).toBeDefined();
      expect(result.results.get("builder")!.parsed!.passed).toBe(true);
    });

    it("returns a failure result when the agent throws", async () => {
      const error = new Error("build failed");
      const agent = makeMockAgentThatThrows(error);
      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "builder",
        systemPrompt: "build",
        prompt: "build",
      };
      const context = new FlowContext(new Map(), "task");

      const result = await executor.execute(instruction, context, vi.fn());

      expect(result.results.get("builder")!.parsed!.passed).toBe(false);
      expect(supervisor.destroyAgent).toHaveBeenCalledWith(agent.id);
    });

    it("calls specManager.resolve with the instruction's systemPrompt as the spec name", async () => {
      const agent = makeMockAgent("done");
      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "builder",
        systemPrompt: "build",
        prompt: "build it",
      };
      const context = new FlowContext(new Map(), "task");

      await executor.execute(instruction, context, vi.fn());

      const resolveCall = (specManager.resolve as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(resolveCall.spec).toBe("build");
    });

    it("handles gracefully when parseJson is true but JSON is malformed", async () => {
      const agent = makeMockAgent("not json at all");
      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "builder",
        systemPrompt: "build",
        prompt: "build",
        parseJson: true,
      };
      const context = new FlowContext(new Map(), "task");

      const result = await executor.execute(instruction, context, vi.fn());

      expect(result.results.get("builder")!.raw).toBe("not json at all");
      expect(result.results.get("builder")!.parsed).toBeUndefined();
    });

    it("parses review-style JSON with findings", async () => {
      const agent = makeMockAgent(
        '```json\n{"passed": false, "findings": {"critical": ["bug"], "warnings": ["style"], "info": []}}\n```',
      );
      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "reviewer",
        systemPrompt: "review",
        prompt: "review",
        parseJson: true,
      };
      const context = new FlowContext(new Map(), "task");

      const result = await executor.execute(instruction, context, vi.fn());

      expect(result.results.get("reviewer")!.parsed!.kind).toBe("review");
      expect(result.results.get("reviewer")!.parsed!.passed).toBe(false);
    });

    it("handles non-Error thrown during execution", async () => {
      // Create an agent that throws a non-Error value.
      const agent = {
        id: "test-agent",
        executeTask: vi.fn().mockRejectedValue("just a string"),
        destroy: vi.fn().mockResolvedValue(undefined),
      } as unknown as SubprocessAgent;
      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "builder",
        systemPrompt: "build",
        prompt: "build",
      };
      const context = new FlowContext(new Map(), "task");

      const result = await executor.execute(instruction, context, vi.fn());

      expect(result.results.get("builder")!.parsed!.passed).toBe(false);
      expect(supervisor.destroyAgent).toHaveBeenCalledWith(agent.id);
    });

    it("handles no JSON block when parseJson is true", async () => {
      const agent = makeMockAgent("just plain text, no json at all");
      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "builder",
        systemPrompt: "build",
        prompt: "build",
        parseJson: true,
      };
      const context = new FlowContext(new Map(), "task");

      const result = await executor.execute(instruction, context, vi.fn());

      // Raw preserved, parsed is undefined because no JSON found
      expect(result.results.get("builder")!.raw).toBe("just plain text, no json at all");
      expect(result.results.get("builder")!.parsed).toBeUndefined();
    });

    it("always calls destroyAgent even when executeTask throws", async () => {
      const error = new Error("crash");
      const agent = makeMockAgentThatThrows(error);
      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "builder",
        systemPrompt: "build",
        prompt: "build",
      };
      const context = new FlowContext(new Map(), "task");

      await executor.execute(instruction, context, vi.fn());

      expect(supervisor.destroyAgent).toHaveBeenCalledWith(agent.id);
    });
  });

  describe("workingDir", () => {
    function contextWithWorkspace(name: string, path: string): FlowContext {
      const base = new FlowContext(new Map(), "task");
      return base.withWorkspace(name, new WorkspaceHandle(path, new Date("2025-01-01T00:00:00Z")));
    }

    it("resolves a {workspace} workingDir to the workspace path and passes it as cwd to spawn", async () => {
      const agent = makeMockAgent("done");
      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "builder",
        systemPrompt: "build",
        prompt: "build",
        workingDir: { workspace: "ws" },
      };
      const context = contextWithWorkspace("ws", "/repos/worktree-ws");

      await executor.execute(instruction, context, vi.fn());

      const spawnedSpec = (supervisor.spawnGuest as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(spawnedSpec.cwd).toBe("/repos/worktree-ws");
      expect(spawnedSpec.id).toBe("test-agent");
    });

    it("throws AgentInstructionWorkingDirMissing when the referenced workspace is not present", async () => {
      const agent = makeMockAgent("done");
      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "builder",
        systemPrompt: "build",
        prompt: "build",
        workingDir: { workspace: "missing" },
      };
      const context = new FlowContext(new Map(), "task");

      await expect(executor.execute(instruction, context, vi.fn())).rejects.toBeInstanceOf(
        AgentInstructionWorkingDirMissing,
      );
      expect(supervisor.spawnGuest).not.toHaveBeenCalled();
    });

    it("uses a {path} workingDir verbatim (after template resolution) as cwd", async () => {
      const agent = makeMockAgent("done");
      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "builder",
        systemPrompt: "build",
        prompt: "build",
        workingDir: { path: "/abs/x" },
      };
      const context = new FlowContext(new Map(), "task");

      await executor.execute(instruction, context, vi.fn());

      const spawnedSpec = (supervisor.spawnGuest as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(spawnedSpec.cwd).toBe("/abs/x");
    });

    it("leaves cwd unset (default behaviour) when workingDir is absent", async () => {
      const agent = makeMockAgent("done");
      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "builder",
        systemPrompt: "build",
        prompt: "build",
      };
      const context = new FlowContext(new Map(), "task");

      await executor.execute(instruction, context, vi.fn());

      const spawnedSpec = (supervisor.spawnGuest as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(spawnedSpec.cwd).toBeUndefined();
    });
  });

  describe("parseJsonOutput edge cases", () => {
    it("parses bare JSON block without ```json fence", async () => {
      const agent = makeMockAgent('{"passed": true, "summary": "bare json"}');
      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "builder",
        systemPrompt: "build",
        prompt: "build",
        parseJson: true,
      };
      const context = new FlowContext(new Map(), "task");

      const result = await executor.execute(instruction, context, vi.fn());

      expect(result.results.get("builder")!.parsed!.passed).toBe(true);
      expect(result.results.get("builder")!.parsed!.kind).toBe("build");
    });

    it("defaults passed to false when missing in build JSON", async () => {
      const agent = makeMockAgent('{"summary": "no passed field"}');
      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "builder",
        systemPrompt: "build",
        prompt: "build",
        parseJson: true,
      };
      const context = new FlowContext(new Map(), "task");

      const result = await executor.execute(instruction, context, vi.fn());

      expect(result.results.get("builder")!.parsed!.passed).toBe(false);
      expect(result.results.get("builder")!.parsed!.kind).toBe("build");
    });

    it("defaults summary to empty string when missing in build JSON", async () => {
      const agent = makeMockAgent('{"passed": true}');
      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "builder",
        systemPrompt: "build",
        prompt: "build",
        parseJson: true,
      };
      const context = new FlowContext(new Map(), "task");

      const result = await executor.execute(instruction, context, vi.fn());

      expect(result.results.get("builder")!.parsed!.passed).toBe(true);
    });

    it("defaults findings sub-fields to empty arrays when missing", async () => {
      const agent = makeMockAgent('{"passed": false, "findings": {}}');
      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "reviewer",
        systemPrompt: "review",
        prompt: "review",
        parseJson: true,
      };
      const context = new FlowContext(new Map(), "task");

      const result = await executor.execute(instruction, context, vi.fn());

      expect(result.results.get("reviewer")!.parsed!.kind).toBe("review");
      expect(result.results.get("reviewer")!.parsed!.passed).toBe(false);
    });

    it("defaults passed to false when missing in review JSON", async () => {
      const agent = makeMockAgent('{"findings": {"critical": [], "warnings": [], "info": []}}');
      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "reviewer",
        systemPrompt: "review",
        prompt: "review",
        parseJson: true,
      };
      const context = new FlowContext(new Map(), "task");

      const result = await executor.execute(instruction, context, vi.fn());

      expect(result.results.get("reviewer")!.parsed!.kind).toBe("review");
      expect(result.results.get("reviewer")!.parsed!.passed).toBe(false);
    });
  });
});
