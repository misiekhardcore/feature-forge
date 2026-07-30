import { randomUUID } from "node:crypto";

import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { logger } from "@feature-forge/shared";
import type { DisplayContribution, DisplayContributionRegistry } from "@feature-forge/tui";

import type { SubprocessAgent } from "../../agents/agents/SubprocessAgent";
import type { SpecManager } from "../../agents/SpecManager";
import type { AgentSupervisor } from "../../agents/supervisors/AgentSupervisor";
import type { TypedEventBus } from "../eventBus";
import type { FlowContext, InstructionResult } from "../FlowContext";
import type { AgentInstruction, FlowInstruction } from "../FlowInstruction";
import type { RoutineProgressEvent } from "../RoutineProgress";
import { StepExecutor } from "../StepExecutor";
import { AgentInstructionWorkingDirMissing } from "./AgentInstructionWorkingDirMissing";
import { extractJson } from "./extractJson";
import { isAbortError } from "./isAbortError";

/**
 * Executes an "agent" instruction by spawning an agent via
 * {@link AgentSupervisor}, executing the task, collecting the result,
 * and destroying the agent.
 *
 * Resolves `{{PLACEHOLDER}}` tokens in the instruction's `task` field
 * before passing to the agent.
 *
 * Uses {@link SpecManager.resolve} to look up named specs from the registry
 * by their system prompt name (e.g. "build", "review").
 */
export class AgentStepExecutor extends StepExecutor<AgentInstruction> {
  readonly type = "agent";

  constructor(
    private readonly supervisor: AgentSupervisor,
    private readonly specManager: SpecManager,
  ) {
    super();
  }

  async execute(
    instruction: AgentInstruction,
    context: FlowContext,
    _executeStep: (
      instruction: FlowInstruction,
      context: FlowContext,
      signal?: AbortSignal,
    ) => Promise<FlowContext>,
    eventBus: TypedEventBus,
    signal?: AbortSignal,
  ): Promise<FlowContext> {
    const instructionId = instruction.id;
    const executionId = randomUUID();

    // Check abort signal before spawning an agent.
    signal?.throwIfAborted();

    // 1. Build the specification from the named spec registry.
    const specification = this.specManager.resolve({
      spec: instruction.systemPrompt,
    });

    // 2. Resolve the task template.
    const resolvedTask = context.resolve(instruction.prompt);

    // 2b. Resolve the agent's working directory when declared on the
    // instruction. The flow loader has already validated that any
    // `{ workspace }` reference names a workspace declared earlier in
    // the same routine; here we resolve it at runtime to a concrete path.
    const cwd = this.resolveCwd(instruction, context);

    // Apply all overrides (cwd, model, thinkingLevel) in a single createDynamic call.
    const overrides: Record<string, unknown> = {};
    if (cwd !== undefined) overrides.cwd = cwd;
    if (instruction.model) overrides.model = instruction.model;
    if (instruction.thinkingLevel) overrides.thinkingLevel = instruction.thinkingLevel;

    const effectiveSpecification =
      Object.keys(overrides).length > 0
        ? this.specManager.createDynamic({ ...specification, ...overrides })
        : specification;

    logger.info("Spawning agent", {
      instructionId,
      spec: instruction.systemPrompt,
      prompt: resolvedTask,
      cwd: effectiveSpecification.cwd,
    });

    // 3. Spawn agent, execute task, collect result, and destroy.
    const agent: SubprocessAgent = await this.supervisor.spawnGuest(effectiveSpecification);

    eventBus.emit("feature-forge:agent-started", {
      phase: "agent-started",
      message: `Agent "${instructionId}" (${instruction.systemPrompt}) started`,
      details: { executionId, agentId: agent.id },
    });

    try {
      await agent.executeTask(resolvedTask, {
        signal,
        onEvent: (event) => {
          eventBus.emit("feature-forge:agent-stream", {
            phase: "agent-stream",
            message: `Agent "${instructionId}" stream event`,
            details: {
              executionId,
              agentId: agent.id,
              label: specification.role,
              event,
            },
          });
        },
      });

      const raw = agent.getResult();
      logger.info("Agent completed", { instructionId, resultLength: raw.length });

      const result = this.buildResult(raw, instruction.parseJson);
      const updatedContext = context.withResult(instructionId, result);

      const agentPassed = result.parsed?.passed;
      const agentSummary = result.parsed?.summary;
      eventBus.emit("feature-forge:agent-done", {
        phase: "agent-done",
        message: `Agent "${instructionId}" completed`,
        details: {
          executionId,
          agentId: agent.id,
          summary: agentSummary,
          passed: agentPassed,
        },
      });

      return updatedContext;
    } catch (error) {
      // Propagate abort signals immediately so the routine can be cancelled
      // without waiting for the current step to finish.
      if (isAbortError(error)) {
        throw error;
      }
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error("Agent execution failed", { instructionId, error: err });

      const failureSummary = `Agent "${instructionId}" failed: ${err.message}`;
      eventBus.emit("feature-forge:agent-done", {
        phase: "agent-done",
        message: `Agent "${instructionId}" failed`,
        details: {
          executionId,
          agentId: agent.id,
          passed: false,
          summary: failureSummary,
        },
      });

      const failureResult: InstructionResult = {
        raw: err.message,
        parsed: {
          passed: false,
          summary: failureSummary,
        },
      };
      return context.withResult(instructionId, failureResult);
    } finally {
      await this.supervisor.destroyAgent(agent.id);
    }
  }

  /**
   * Extract agent display info from a progress event.
   *
   * Reads the agentId from {@code event.details.agentId} and maps the
   * phase to a lifecycle status.
   */
  override registerDisplayHandler(registry: DisplayContributionRegistry): void {
    registry.register("agent", (state, contribution) => {
      if (contribution.type !== "agent") return;
      if (contribution.agentId && contribution.agentStatus) {
        state.agentMap.set(contribution.agentId, {
          status: contribution.agentStatus,
          summary: contribution.agentSummary,
          passed: contribution.agentPassed,
        });
      }
    });
  }

  override getDisplayContribution(event: RoutineProgressEvent): DisplayContribution | undefined {
    if (
      event.phase !== "agent-started" &&
      event.phase !== "agent-done" &&
      event.phase !== "agent-stream"
    ) {
      return undefined;
    }
    const { agentId, executionId } = event.details;
    if (!agentId) {
      return undefined;
    }
    const agentStatus: string =
      event.phase === "agent-started"
        ? "started"
        : event.phase === "agent-done"
          ? "done"
          : "streaming";
    const details = event.details as {
      executionId?: string;
      agentId: string;
      summary?: string;
      passed?: boolean;
      event?: AgentEvent;
    };
    const streamEvent = event.phase === "agent-stream" ? details.event : undefined;
    return {
      type: "agent",
      executionId,
      agentId,
      agentStatus,
      agentSummary: details.summary,
      agentPassed: details.passed,
      streamEvent,
      phase: event.phase,
      message: event.message,
    };
  }

  /**
   * Resolve `instruction.workingDir` (if present) to a concrete path.
   *
   * - `{ workspace: <name> }`: the name is template-resolved via the context
   *   and looked up through `context.getWorkspacePath`. Throws
   *   {@link AgentInstructionWorkingDirMissing} when the workspace is not
   *   available at runtime.
   * - `{ path: <p> }`: `<p>` is template-resolved and used verbatim.
   * - absent: returns `undefined`.
   */
  private resolveCwd(instruction: AgentInstruction, context: FlowContext): string | undefined {
    const workingDir = instruction.workingDir;
    if (workingDir === undefined) {
      return undefined;
    }
    return this.resolveWorkingDirPath(workingDir, context, instruction.id);
  }

  /**
   * Resolve a `workingDir` instruction value to a concrete filesystem path.
   */
  private resolveWorkingDirPath(
    workingDir: NonNullable<AgentInstruction["workingDir"]>,
    context: FlowContext,
    instructionId: string,
  ): string {
    if ("workspace" in workingDir) {
      const workspaceName = context.resolve(workingDir.workspace);
      const workspacePath = context.getWorkspacePath(workspaceName);
      if (workspacePath === undefined) {
        throw new AgentInstructionWorkingDirMissing(instructionId, workspaceName);
      }
      return workspacePath;
    }
    return context.resolve(workingDir.path);
  }

  private buildResult(raw: string, parseJson?: boolean): InstructionResult {
    if (!parseJson) {
      return { raw };
    }

    const parsed = extractJson(raw);
    return { raw, parsed };
  }
}
