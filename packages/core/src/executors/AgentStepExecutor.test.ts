// Test-only value imports from cli: self-heal when cli/src/workspace
// and cli test-utils move to core (S4e) (#229).
import { makeMockTypedEventBus } from "@feature-forge/cli/src/test-utils";
import { WorkspaceHandle } from "@feature-forge/cli/src/workspace/WorkspaceHandle";
import { logger } from "@feature-forge/core";
import type { AgentSpecification } from "@feature-forge/core/src/agents/specifications/AgentSpecification";
import type { SpecManager } from "@feature-forge/core/src/agents/SpecManager";
import type { SubprocessAgent } from "@feature-forge/core/src/agents/SubprocessAgent";
import type { AgentSupervisor } from "@feature-forge/core/src/agents/supervisors/AgentSupervisor";
import { FlowContext } from "@feature-forge/core/src/flows/FlowContext";
import type { AgentInstruction } from "@feature-forge/core/src/flows/FlowInstruction";
import type { AgentContribution } from "@feature-forge/tui";
import { createAccumulatedState, DisplayContributionRegistry } from "@feature-forge/tui";
import { describe, expect, it, vi } from "vitest";

import { AgentInstructionWorkingDirMissing } from "./AgentInstructionWorkingDirMissing";
import { AgentStepExecutor } from "./AgentStepExecutor";

// ── Helpers ──────────────────────────────────────────────────

function makeMockSpecManager(): SpecManager {
  const createDynamicSpy = vi.fn().mockImplementation((spec: AgentSpecification) => spec);
  // Expose the spy on the returned object so tests can assert on it.
  return {
    createDynamic: createDynamicSpy,
    resolve: vi.fn().mockReturnValue({
      id: "test-agent",
      role: "test",
      systemPrompt: "prompt",
      toolRestrictions: {},
      get tools() {
        return [];
      },
    }),
    // Attach spy reference so tests can inspect captured args.
    _createDynamicSpy: createDynamicSpy,
  } as unknown as SpecManager & { _createDynamicSpy: ReturnType<typeof vi.fn> };
}

function makeMockAgent(result: string): SubprocessAgent {
  return {
    id: "test-agent",
    kind: "subprocess",
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
    retry: vi.fn().mockRejectedValue(new Error("retry not configured")),
    destroy: vi.fn().mockResolvedValue(undefined),
  } as unknown as SubprocessAgent;
}

function makeMockAgentThatThrows(error: Error): SubprocessAgent {
  return {
    id: "test-agent",
    kind: "subprocess",
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

      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

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

      await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

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

      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

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

      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

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

      await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      const resolveCall = (specManager.resolve as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(resolveCall.spec).toBe("build");
    });

    it("overrides model in the specification via createDynamic when instruction.model is set", async () => {
      const agent = makeMockAgent("done");
      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "builder",
        systemPrompt: "build",
        prompt: "build it",
        model: "claude-sonnet-4-5",
      };
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
      });

      await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      // Verify createDynamic was called with the model field
      const createDynamicSpy = (
        specManager as unknown as { _createDynamicSpy: ReturnType<typeof vi.fn> }
      )._createDynamicSpy;
      expect(createDynamicSpy).toHaveBeenCalledWith(
        expect.objectContaining({ model: "claude-sonnet-4-5" }),
      );

      // Verify spawnGuest received the spec with model override
      const spawnedSpec = (supervisor.spawnGuest as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(spawnedSpec.model).toBe("claude-sonnet-4-5");
    });

    it("passes both cwd and model when workingDir and model are set", async () => {
      const agent = makeMockAgent("done");
      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "builder",
        systemPrompt: "build",
        prompt: "build it",
        workingDir: { path: "/tmp/custom-path" },
        model: "claude-sonnet-4-5",
      };
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
      });

      await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      // Both cwd and model overrides are merged into a single createDynamic call.
      const createDynamicSpy = (
        specManager as unknown as { _createDynamicSpy: ReturnType<typeof vi.fn> }
      )._createDynamicSpy;
      expect(createDynamicSpy).toHaveBeenCalledTimes(1);
      expect(createDynamicSpy).toHaveBeenCalledWith(
        expect.objectContaining({ cwd: "/tmp/custom-path", model: "claude-sonnet-4-5" }),
      );

      // The final spec passed to spawnGuest carries both cwd and model.
      const spawnedSpec = (supervisor.spawnGuest as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(spawnedSpec.cwd).toBe("/tmp/custom-path");
      expect(spawnedSpec.model).toBe("claude-sonnet-4-5");
    });

    it("overrides thinkingLevel in the specification via createDynamic when instruction.thinkingLevel is set", async () => {
      const agent = makeMockAgent("done");
      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "builder",
        systemPrompt: "build",
        prompt: "build it",
        thinkingLevel: "high",
      };
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
      });

      await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      const createDynamicSpy = (
        specManager as unknown as { _createDynamicSpy: ReturnType<typeof vi.fn> }
      )._createDynamicSpy;
      expect(createDynamicSpy).toHaveBeenCalledWith(
        expect.objectContaining({ thinkingLevel: "high" }),
      );
    });

    it("passes both cwd, model, and thinkingLevel overrides together via a single createDynamic call", async () => {
      const agent = makeMockAgent("done");
      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "builder",
        systemPrompt: "build",
        prompt: "build it",
        workingDir: { path: "/tmp/custom-path" },
        model: "claude-sonnet-4-5",
        thinkingLevel: "high",
      };
      const context = new FlowContext({
        results: new Map(),
        prompt: "task",
      });

      await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      const createDynamicSpy = (
        specManager as unknown as { _createDynamicSpy: ReturnType<typeof vi.fn> }
      )._createDynamicSpy;
      expect(createDynamicSpy).toHaveBeenCalledTimes(1);
      expect(createDynamicSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: "/tmp/custom-path",
          model: "claude-sonnet-4-5",
          thinkingLevel: "high",
        }),
      );
    });

    it("does not call createDynamic when instruction.model and workingDir are not set", async () => {
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

      await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      // Neither model nor workingDir is set, so createDynamic should not be called.
      const createDynamicSpy = (
        specManager as unknown as { _createDynamicSpy: ReturnType<typeof vi.fn> }
      )._createDynamicSpy;
      expect(createDynamicSpy).not.toHaveBeenCalled();
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

      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(result.results.get("builder")!.raw).toBe("not json at all");
      expect(result.results.get("builder")!.parsed!.passed).toBe(false);
      expect(result.results.get("builder")!.parsed!.summary).toBe(
        "Agent did not produce valid JSON output",
      );
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

      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(result.results.get("reviewer")!.parsed!.details).toBeDefined();
      expect(result.results.get("reviewer")!.parsed!.passed).toBe(false);
    });

    it("handles non-Error thrown during execution", async () => {
      // Create an agent that throws a non-Error value.
      const agent = {
        id: "test-agent",
        kind: "subprocess",
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

      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(result.results.get("builder")!.parsed!.passed).toBe(false);
      expect(supervisor.destroyAgent).toHaveBeenCalledWith(agent.id);
    });

    it("handles no JSON block when parseJson is true", async () => {
      const agent = makeMockAgent("just plain text, no json at all");
      // Both retries return non-JSON content, so the executor exhausts its attempts.
      (agent.retry as ReturnType<typeof vi.fn>).mockResolvedValue("still no json");
      (agent.getResult as ReturnType<typeof vi.fn>).mockReturnValue("still no json");
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

      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      // Raw preserved, parsed is a failure result because no JSON found
      expect(result.results.get("builder")!.raw).toBe("still no json");
      expect(agent.retry).toHaveBeenCalledTimes(2);
      expect(result.results.get("builder")!.parsed!.passed).toBe(false);
      expect(result.results.get("builder")!.parsed!.summary).toBe(
        "Agent did not produce valid JSON output",
      );
    });

    it("retries when parseJson is true and initial response has no JSON block", async () => {
      const agent = makeMockAgent("no json here");
      (agent.retry as ReturnType<typeof vi.fn>).mockResolvedValue(
        'Here is the corrected output.\n\n```json\n{"passed": true, "summary": "all good"}\n```',
      );
      (agent.getResult as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce("no json here")
        .mockReturnValue(
          'Here is the corrected output.\n\n```json\n{"passed": true, "summary": "all good"}\n```',
        );

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
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(agent.retry).toHaveBeenCalledTimes(1);
      expect(result.results.get("builder")!.parsed!.passed).toBe(true);
      expect(result.results.get("builder")!.parsed!.summary).toBe("all good");
    });

    it("falls back to failure after max retries when JSON still missing", async () => {
      const agent = makeMockAgent("no json here");
      (agent.retry as ReturnType<typeof vi.fn>).mockResolvedValue("still no json");
      (agent.getResult as ReturnType<typeof vi.fn>).mockReturnValue("still no json");

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
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      // 2 retry attempts, both failed
      expect(agent.retry).toHaveBeenCalledTimes(2);
      expect(result.results.get("builder")!.parsed!.passed).toBe(false);
      expect(result.results.get("builder")!.parsed!.summary).toBe(
        "Agent did not produce valid JSON output",
      );
    });

    it("stops retrying on transport errors and falls back to the original output", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      try {
        const agent = makeMockAgent("no json here");
        (agent.retry as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("rpc down"));
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
        const context = new FlowContext({ results: new Map(), prompt: "task" });

        const result = await executor.execute(
          instruction,
          context,
          vi.fn(),
          makeMockTypedEventBus(),
        );

        // The transport error breaks the loop after the first attempt; the raw
        // output is used for the failure result.
        expect(agent.retry).toHaveBeenCalledTimes(1);
        expect(result.results.get("builder")!.raw).toBe("no json here");
        expect(result.results.get("builder")!.parsed!.passed).toBe(false);
        expect(result.results.get("builder")!.parsed!.summary).toBe(
          "Agent did not produce valid JSON output",
        );
        // The transport failure is logged, not silently swallowed.
        expect(warnSpy).toHaveBeenCalledWith(
          "Agent retry failed, falling back to original output",
          expect.objectContaining({ instructionId: "builder" }),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("forwards the abort signal to retry so the retry loop can be cancelled", async () => {
      const agent = makeMockAgent("no json here");
      (agent.retry as ReturnType<typeof vi.fn>).mockResolvedValue(
        '```json\n{"passed": true, "summary": "all good"}\n```',
      );
      (agent.getResult as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce("no json here")
        .mockReturnValue('```json\n{"passed": true, "summary": "all good"}\n```');

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
      const context = new FlowContext({ results: new Map(), prompt: "task" });
      const controller = new AbortController();

      await executor.execute(
        instruction,
        context,
        vi.fn(),
        makeMockTypedEventBus(),
        controller.signal,
      );

      expect(agent.retry).toHaveBeenCalledWith(
        expect.stringContaining("JSON"),
        expect.objectContaining({ signal: controller.signal }),
      );
    });

    it("does not retry when parseJson is false even if output lacks JSON", async () => {
      const agent = makeMockAgent("no json here");
      (agent.retry as ReturnType<typeof vi.fn>).mockResolvedValue("ignored");

      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "builder",
        systemPrompt: "build",
        prompt: "build",
        parseJson: false,
      };
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(agent.retry).not.toHaveBeenCalled();
      expect(result.results.get("builder")!.parsed).toBeUndefined();
    });

    it("respects maxJsonRetries when configured on the instruction", async () => {
      const agent = makeMockAgent("no json here");
      (agent.retry as ReturnType<typeof vi.fn>).mockResolvedValue("still no json");
      (agent.getResult as ReturnType<typeof vi.fn>).mockReturnValue("still no json");

      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "builder",
        systemPrompt: "build",
        prompt: "build",
        parseJson: true,
        maxJsonRetries: 1,
      };
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(agent.retry).toHaveBeenCalledTimes(1);
      expect(result.results.get("builder")!.parsed!.passed).toBe(false);
    });

    it("skips retries entirely when maxJsonRetries is 0", async () => {
      const agent = makeMockAgent("no json here");
      (agent.retry as ReturnType<typeof vi.fn>).mockResolvedValue("ignored");

      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      const executor = new AgentStepExecutor(supervisor, specManager);

      const instruction: AgentInstruction = {
        type: "agent",
        id: "builder",
        systemPrompt: "build",
        prompt: "build",
        parseJson: true,
        maxJsonRetries: 0,
      };
      const context = new FlowContext({ results: new Map(), prompt: "task" });

      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

      expect(agent.retry).not.toHaveBeenCalled();
      expect(result.results.get("builder")!.parsed!.passed).toBe(false);
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
        executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus(), controller.signal),
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
        executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus()),
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

      await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

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

      await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

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
        executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus()),
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

      await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

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

        const eventBus = makeMockTypedEventBus();
        await executor.execute(instruction, context, vi.fn(), eventBus);

        expect(eventBus.raw.emit).toHaveBeenCalledTimes(4);
        expect(eventBus.raw.emit).toHaveBeenNthCalledWith(
          1,
          "feature-forge:agent-started",
          expect.objectContaining({
            phase: "agent-started",
            message: expect.stringContaining("builder") as string,
            details: expect.objectContaining({
              executionId: expect.any(String) as string,
              agentId: "test-agent",
            }),
          }),
        );
        expect(eventBus.raw.emit).toHaveBeenNthCalledWith(
          4,
          "feature-forge:agent-done",
          expect.objectContaining({
            phase: "agent-done",
            message: expect.stringContaining("builder") as string,
            details: expect.objectContaining({
              executionId: expect.any(String) as string,
              agentId: "test-agent",
            }),
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

        const eventBus = makeMockTypedEventBus();
        await executor.execute(instruction, context, vi.fn(), eventBus);

        expect(eventBus.raw.emit).toHaveBeenCalledWith(
          "feature-forge:agent-done",
          expect.objectContaining({
            phase: "agent-done",
            details: expect.objectContaining({
              agentId: "test-agent",
              passed: false,
              summary: "1 critical, 1 warnings",
            }),
          }),
        );
      });

      it("emits agent-done with passed: false when agent execution fails", async () => {
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

        const eventBus = makeMockTypedEventBus();
        await executor.execute(instruction, context, vi.fn(), eventBus);

        // Both agent-started and agent-done are fired.
        expect(eventBus.raw.emit).toHaveBeenCalledTimes(2);
        expect(eventBus.raw.emit).toHaveBeenNthCalledWith(
          1,
          "feature-forge:agent-started",
          expect.anything(),
        );
        expect(eventBus.raw.emit).toHaveBeenNthCalledWith(
          2,
          "feature-forge:agent-done",
          expect.objectContaining({
            phase: "agent-done",
            message: expect.stringContaining("builder") as string,
            details: expect.objectContaining({
              agentId: "test-agent",
              passed: false,
              summary: `Agent "builder" failed: build failed`,
            }),
          }),
        );
      });

      it("emits agent-done with passed: false when parseJson output is invalid", async () => {
        const agent = makeMockAgent("no json here");
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

        const eventBus = makeMockTypedEventBus();
        await executor.execute(instruction, context, vi.fn(), eventBus);

        expect(eventBus.raw.emit).toHaveBeenCalledWith(
          "feature-forge:agent-done",
          expect.objectContaining({
            phase: "agent-done",
            details: expect.objectContaining({
              agentId: "test-agent",
              passed: false,
              summary: "Agent did not produce valid JSON output",
            }),
          }),
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

        const eventBus = makeMockTypedEventBus();
        await executor.execute(instruction, context, vi.fn(), eventBus);

        // agent-started, 2x agent-stream, agent-done = 4 emits
        expect(eventBus.raw.emit).toHaveBeenCalledTimes(4);
        expect(eventBus.raw.emit).toHaveBeenCalledWith(
          "feature-forge:agent-stream",
          expect.objectContaining({
            phase: "agent-stream",
            details: expect.objectContaining({
              executionId: expect.any(String) as string,
              agentId: "test-agent",
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
        const result = await executor.execute(
          instruction,
          context,
          vi.fn(),
          makeMockTypedEventBus(),
        );

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

      await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

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

      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

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

      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

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

      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

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

      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

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

      const result = await executor.execute(instruction, context, vi.fn(), makeMockTypedEventBus());

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
        details: { agentId: "builder", executionId: "" },
      });

      expect(contrib).toBeDefined();
      const agentContrib = contrib as AgentContribution;
      expect(agentContrib.agentId).toBe("builder");
      expect(agentContrib.agentStatus).toBe("started");
    });

    it("returns agentId and agentStatus for agent-done events", () => {
      const executor = makeExecutor();
      const contrib = executor.getDisplayContribution({
        phase: "agent-done",
        message: 'Agent "reviewer" completed',
        details: { agentId: "reviewer", summary: "All good", executionId: "", passed: true },
      });

      expect(contrib).toBeDefined();
      const agentContrib = contrib as AgentContribution;
      expect(agentContrib.agentId).toBe("reviewer");
      expect(agentContrib.agentStatus).toBe("done");
      expect(agentContrib.agentSummary).toBe("All good");
    });

    it("extracts agentPassed from agent-done event details", () => {
      const executor = makeExecutor();
      const contrib = executor.getDisplayContribution({
        phase: "agent-done",
        message: 'Agent "reviewer" completed',
        details: { agentId: "reviewer", summary: "3 critical", passed: false, executionId: "" },
      });

      expect(contrib).toBeDefined();
      const agentContrib = contrib as AgentContribution;
      expect(agentContrib.agentStatus).toBe("done");
      expect(agentContrib.agentPassed).toBe(false);
      expect(agentContrib.agentSummary).toBe("3 critical");
    });

    it("returns undefined for non-agent phase events", () => {
      const executor = makeExecutor();
      const contrib = executor.getDisplayContribution({
        phase: "workspace-ready",
        message: "Workspace /tmp/ws ready",
        details: { branch: "branch", path: "path", executionId: "" },
      });

      expect(contrib).toBeUndefined();
    });

    it("returns undefined when event details lack agentId", () => {
      const executor = makeExecutor();
      const contrib = executor.getDisplayContribution(
        // @ts-expect-error testing edge case
        {
          phase: "agent-started",
          message: "Agent started successfully",
          details: {},
        },
      );

      expect(contrib).toBeUndefined();
    });

    it("includes streamEvent from event details for agent-stream phase", () => {
      const executor = makeExecutor();
      const streamPayload = {
        type: "tool_execution_start" as const,
        toolCallId: "t1",
        toolName: "read",
        args: {},
      };
      const contrib = executor.getDisplayContribution({
        phase: "agent-stream",
        message: 'Agent "builder" stream event',
        details: { agentId: "builder", event: streamPayload, executionId: "", label: "label" },
      });

      expect(contrib).toBeDefined();
      const agentContrib = contrib as AgentContribution;
      expect(agentContrib.agentId).toBe("builder");
      expect(agentContrib.agentStatus).toBe("running");
      expect(agentContrib.streamEvent).toBe(streamPayload);
      expect(agentContrib.phase).toBe("agent-stream");
    });

    it("returns streamEvent undefined for non-stream agent events", () => {
      const executor = makeExecutor();
      const contrib = executor.getDisplayContribution({
        phase: "agent-started",
        message: 'Agent "builder" (build) started',
        details: { agentId: "builder", executionId: "" },
      });

      expect(contrib).toBeDefined();
      const agentContrib = contrib as AgentContribution;
      expect(agentContrib.streamEvent).toBeUndefined();
    });

    it("extracts executionId from event details for agent-started phase", () => {
      const executor = makeExecutor();
      const contrib = executor.getDisplayContribution({
        phase: "agent-started",
        message: 'Agent "builder" (build) started',
        details: { executionId: "exec-abc-123", agentId: "builder" },
      });

      expect(contrib).toBeDefined();
      const agentContrib = contrib as AgentContribution;
      expect(agentContrib.executionId).toBe("exec-abc-123");
      expect(agentContrib.agentId).toBe("builder");
    });

    it("extracts executionId and summary from agent-done event details", () => {
      const executor = makeExecutor();
      const contrib = executor.getDisplayContribution({
        phase: "agent-done",
        message: 'Agent "reviewer" completed',
        details: {
          executionId: "exec-xyz-789",
          agentId: "reviewer",
          summary: "All tests passed",
        },
      });

      expect(contrib).toBeDefined();
      const agentContrib = contrib as AgentContribution;
      expect(agentContrib.executionId).toBe("exec-xyz-789");
      expect(agentContrib.agentId).toBe("reviewer");
      expect(agentContrib.agentStatus).toBe("done");
      expect(agentContrib.agentSummary).toBe("All tests passed");
    });

    it("extracts executionId from agent-stream event details", () => {
      const executor = makeExecutor();
      const streamPayload = {
        type: "tool_execution_start" as const,
        toolCallId: "t2",
        toolName: "read",
        args: {},
      };
      const contrib = executor.getDisplayContribution({
        phase: "agent-stream",
        message: 'Agent "builder" stream event',
        details: {
          executionId: "exec-stream-1",
          agentId: "builder",
          event: streamPayload,
          label: "label",
        },
      });

      expect(contrib).toBeDefined();
      const agentContrib = contrib as AgentContribution;
      expect(agentContrib.executionId).toBe("exec-stream-1");
      expect(agentContrib.streamEvent).toBe(streamPayload);
    });
  });

  describe("registerDisplayHandler", () => {
    function makeExecutor(): AgentStepExecutor {
      const agent = makeMockAgent("output");
      const supervisor = makeMockSupervisor(agent);
      const specManager = makeMockSpecManager();
      return new AgentStepExecutor(supervisor, specManager);
    }

    it("registers an agent handler that updates agentMap in accumulated state", () => {
      const executor = makeExecutor();
      const registry = new DisplayContributionRegistry();
      executor.registerDisplayHandler(registry);

      const state = createAccumulatedState();
      registry.apply(state, [
        {
          type: "agent",
          agentId: "builder",
          agentStatus: "started",
          phase: "test",
          message: "test",
        },
        {
          type: "agent",
          agentId: "reviewer",
          agentStatus: "done",
          agentSummary: "All OK",
          agentPassed: true,
          phase: "test",
          message: "test",
        },
      ]);

      expect(state.agentMap.size).toBe(2);
      expect(state.agentMap.get("builder")?.status).toBe("started");
      expect(state.agentMap.get("reviewer")?.status).toBe("done");
      expect(state.agentMap.get("reviewer")?.summary).toBe("All OK");
      expect(state.agentMap.get("reviewer")?.passed).toBe(true);
    });

    it("skips contributions that do not match known types", () => {
      const executor = makeExecutor();
      const registry = new DisplayContributionRegistry();
      executor.registerDisplayHandler(registry);

      const state = createAccumulatedState();
      registry.apply(state, [
        {
          type: "agent",
          agentId: "builder",
          agentStatus: "done",
          phase: "test",
          message: "test",
        },
        { type: "status", phase: "test", message: "test" },
      ]);

      expect(state.agentMap.size).toBe(1);
      expect(state.agentMap.get("builder")?.status).toBe("done");
    });

    it("overwrites a previous handler when a new one is registered for the same type", () => {
      const executor = makeExecutor();
      const registry = new DisplayContributionRegistry();

      // Register twice — second should overwrite first
      executor.registerDisplayHandler(registry);
      registry.register("agent", (state) => {
        state.agentMap.set("overwritten", { status: "done" });
      });

      const state = createAccumulatedState();
      registry.apply(state, [
        { type: "agent", agentId: "builder", agentStatus: "done", phase: "test", message: "test" },
      ]);

      // The overwritten handler runs, not the original one
      expect(state.agentMap.has("builder")).toBe(false);
      expect(state.agentMap.get("overwritten")?.status).toBe("done");
    });
  });
});
