import { describe, expect, it, vi } from "vitest";

import type { SubprocessAgent } from "../../agents/agents/SubprocessAgent";
import type { AgentSpecification } from "../../agents/specifications/AgentSpecification";
import type { SpecManager } from "../../agents/SpecManager";
import type { AgentSupervisor } from "../../agents/supervisors/AgentSupervisor";
import { makeMockEventBus } from "../../test-utils";
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
    }),
  } as unknown as SpecManager;
}

function makeMockAgent(result: string): SubprocessAgent {
  return {
    id: "test-agent",
    executeTask: vi
      .fn()
      .mockImplementation(
        (
          _prompt: string,
          options?: { signal?: AbortSignal; onEvent?: (event: object) => void },
        ) => {
          // Simulate streaming: fire a few events through the callback
          options?.onEvent?.({ type: "tool_use", tool: "read" });
          options?.onEvent?.({
            type: "message_end",
            message: { role: "assistant", content: [{ type: "text", text: result }] },
          });
          return Promise.resolve(result);
        },
      ),
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
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
      });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      expect(specManager.resolve).toHaveBeenCalled();
      expect(supervisor.spawnGuest).toHaveBeenCalled();
      expect(agent.executeTask).toHaveBeenCalledWith(
        "do the thing",
        expect.objectContaining({ signal: undefined }),
      );
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
      const context = new FlowContext({
        results: new Map(),
        prompt: "add auth",
      });

      await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      expect(agent.executeTask).toHaveBeenCalledWith(
        "do add auth",
        expect.objectContaining({ signal: undefined }),
      );
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
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
      });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

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
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
      });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

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
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
      });

      await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

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
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
      });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

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
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
      });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      expect(result.results.get("reviewer")!.parsed!.details).toBeDefined();
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
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
      });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

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
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
      });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      // Raw preserved, parsed is undefined because no JSON found
      expect(result.results.get("builder")!.raw).toBe("just plain text, no json at all");
      expect(result.results.get("builder")!.parsed).toBeUndefined();
    });

    it("throws AbortError when signal is aborted before spawn", async () => {
      const agent = makeMockAgent("output");
      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "builder",
        systemPrompt: "build",
        prompt: "build",
      };
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
      });
      const controller = new AbortController();
      controller.abort();

      await expect(
        executor.execute(instruction, context, vi.fn(), makeMockEventBus(), controller.signal),
      ).rejects.toThrow();

      // Agent was never spawned.
      expect(supervisor.spawnGuest).not.toHaveBeenCalled();
      // destroyAgent is not called because spawn never happened.
      expect(supervisor.destroyAgent).not.toHaveBeenCalled();
    });

    it("re-throws AbortError instead of returning a failure result", async () => {
      const abortError = new DOMException("The operation was aborted", "AbortError");
      const agent = makeMockAgentThatThrows(abortError);
      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "builder",
        systemPrompt: "build",
        prompt: "build",
      };
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
      });

      await expect(
        executor.execute(instruction, context, vi.fn(), makeMockEventBus()),
      ).rejects.toThrow("The operation was aborted");

      // destroyAgent is still called in the finally block.
      expect(supervisor.destroyAgent).toHaveBeenCalledWith(agent.id);
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
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
      });

      await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      expect(supervisor.destroyAgent).toHaveBeenCalledWith(agent.id);
    });
  });

  describe("workingDir", () => {
    function contextWithWorkspace(name: string, path: string): FlowContext {
      const base = new FlowContext({
        results: new Map(),
        prompt: "task",
      });
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

      await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

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
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
      });

      await expect(
        executor.execute(instruction, context, vi.fn(), makeMockEventBus()),
      ).rejects.toBeInstanceOf(AgentInstructionWorkingDirMissing);
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
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
      });

      await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      const spawnedSpec = (supervisor.spawnGuest as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(spawnedSpec.cwd).toBe("/abs/x");
    });

    describe("eventBus", () => {
      it("emits agent-started and agent-done events", async () => {
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
        const context = new FlowContext({
          results: new Map(),
          prompt: "task",
        });

        const eventBus = makeMockEventBus();
        await executor.execute(instruction, context, vi.fn(), eventBus);

        expect(eventBus.emit).toHaveBeenCalledTimes(4);
        expect(eventBus.emit).toHaveBeenNthCalledWith(
          1,
          "feature-forge:agent-started",
          expect.objectContaining({
            phase: "agent-started",
            message: expect.stringContaining("builder") as string,
          }),
        );
        expect(eventBus.emit).toHaveBeenNthCalledWith(
          4,
          "feature-forge:agent-done",
          expect.objectContaining({
            phase: "agent-done",
            message: expect.stringContaining("builder") as string,
          }),
        );
      });

      it("carries passed and summary in agent-done event for review agents", async () => {
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
        const context = new FlowContext({
          results: new Map(),
          prompt: "task",
        });

        const eventBus = makeMockEventBus();
        await executor.execute(instruction, context, vi.fn(), eventBus);

        expect(eventBus.emit).toHaveBeenCalledWith(
          "feature-forge:agent-done",
          expect.objectContaining({
            phase: "agent-done",
            details: expect.objectContaining({
              passed: false,
              summary: "1 critical, 1 warnings",
            }),
          }),
        );
      });

      it("does not emit agent-done when agent execution fails", async () => {
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
        const context = new FlowContext({
          results: new Map(),
          prompt: "task",
        });

        const eventBus = makeMockEventBus();
        await executor.execute(instruction, context, vi.fn(), eventBus);

        // Only agent-started is fired; agent-done is NOT fired on failure.
        expect(eventBus.emit).toHaveBeenCalledTimes(1);
        expect(eventBus.emit).toHaveBeenCalledWith(
          "feature-forge:agent-started",
          expect.anything(),
        );
      });

      it("emits agent-stream events during agent execution", async () => {
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
        const context = new FlowContext({
          results: new Map(),
          prompt: "task",
        });

        const eventBus = makeMockEventBus();
        await executor.execute(instruction, context, vi.fn(), eventBus);

        // agent-started, 2x agent-stream, agent-done = 4 emits
        expect(eventBus.emit).toHaveBeenCalledTimes(4);
        expect(eventBus.emit).toHaveBeenCalledWith(
          "feature-forge:agent-stream",
          expect.objectContaining({
            phase: "agent-stream",
            details: expect.objectContaining({
              agentId: "builder",
              label: "test",
              event: expect.objectContaining({ type: "tool_use" }),
            }),
          }),
        );
      });

      it("works with a no-op eventBus", async () => {
        const agent = makeMockAgent("output");
        const supervisor = makeMockSupervisor(agent);
        const specManager = makeMockSpecManager();
        const executor = new AgentStepExecutor(supervisor, specManager);

        const instruction: AgentInstruction = {
          type: "agent",
          id: "builder",
          systemPrompt: "build",
          prompt: "build",
        };
        const context = new FlowContext({
          results: new Map(),
          prompt: "task",
        });

        // Should work with an event bus that is mocked.
        const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

        expect(result.results.get("builder")!.raw).toBe("output");
      });
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
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
      });

      await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

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
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
      });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      expect(result.results.get("builder")!.parsed!.passed).toBe(true);
      expect(result.results.get("builder")!.parsed!.details).toBeUndefined();
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
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
      });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      expect(result.results.get("builder")!.parsed!.passed).toBe(false);
      expect(result.results.get("builder")!.parsed!.details).toBeUndefined();
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
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
      });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

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
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
      });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      expect(result.results.get("reviewer")!.parsed!.details).toBeDefined();
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
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
      });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockEventBus());

      expect(result.results.get("reviewer")!.parsed!.details).toBeDefined();
      expect(result.results.get("reviewer")!.parsed!.passed).toBe(false);
    });
  });

  describe("getDisplayContribution", () => {
    function makeExecutor(): AgentStepExecutor {
      const agent = makeMockAgent("output");
      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      return new AgentStepExecutor(supervisor, specManager);
    }

    it("returns agentId and agentStatus for agent-started events", () => {
      const executor = makeExecutor();
      const contrib = executor.getDisplayContribution({
        phase: "agent-started",
        message: 'Agent "builder" (build) started',
        details: {},
      });

      expect(contrib).toBeDefined();
      expect(contrib!.agentId).toBe("builder");
      expect(contrib!.agentStatus).toBe("started");
    });

    it("returns agentId and agentStatus for agent-done events", () => {
      const executor = makeExecutor();
      const contrib = executor.getDisplayContribution({
        phase: "agent-done",
        message: 'Agent "reviewer" completed',
        details: { summary: "All good" },
      });

      expect(contrib).toBeDefined();
      expect(contrib!.agentId).toBe("reviewer");
      expect(contrib!.agentStatus).toBe("done");
      expect(contrib!.agentSummary).toBe("All good");
    });

    it("extracts agentPassed from agent-done event details", () => {
      const executor = makeExecutor();
      const contrib = executor.getDisplayContribution({
        phase: "agent-done",
        message: 'Agent "reviewer" completed',
        details: { summary: "3 critical", passed: false },
      });

      expect(contrib).toBeDefined();
      expect(contrib!.agentStatus).toBe("done");
      expect(contrib!.agentPassed).toBe(false);
      expect(contrib!.agentSummary).toBe("3 critical");
    });

    it("returns agentStatus 'error' for agent-error phase", () => {
      const executor = makeExecutor();
      const contrib = executor.getDisplayContribution({
        phase: "agent-error",
        message: 'Agent "builder" failed: something broke',
        details: {},
      });

      expect(contrib!.agentStatus).toBe("error");
    });

    it("returns undefined for non-agent phase events", () => {
      const executor = makeExecutor();
      const contrib = executor.getDisplayContribution({
        phase: "workspace-ready",
        message: "Workspace /tmp/ws ready",
        details: {},
      });

      expect(contrib).toBeUndefined();
    });

    it("returns undefined when the message does not contain an agent id", () => {
      const executor = makeExecutor();
      const contrib = executor.getDisplayContribution({
        phase: "agent-started",
        message: "Agent started successfully",
        details: {},
      });

      expect(contrib).toBeUndefined();
    });

    it("includes streamEvent from event details for agent-stream phase", () => {
      const executor = makeExecutor();
      const streamPayload = { type: "tool_use", tool: "read" };
      const contrib = executor.getDisplayContribution({
        phase: "agent-stream",
        message: 'Agent "builder" stream event',
        details: { agentId: "builder", event: streamPayload },
      });

      expect(contrib).toBeDefined();
      expect(contrib!.agentId).toBe("builder");
      expect(contrib!.agentStatus).toBeUndefined();
      expect(contrib!.streamEvent).toBe(streamPayload);
      expect(contrib!.phase).toBe("agent-stream");
    });

    it("returns streamEvent undefined for non-stream agent events", () => {
      const executor = makeExecutor();
      const contrib = executor.getDisplayContribution({
        phase: "agent-started",
        message: 'Agent "builder" (build) started',
        details: { event: { ignored: true } },
      });

      expect(contrib).toBeDefined();
      expect(contrib!.streamEvent).toBeUndefined();
    });
  });
});
