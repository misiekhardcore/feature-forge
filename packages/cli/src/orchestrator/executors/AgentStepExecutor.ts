import { randomUUID } from "node:crypto";

import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { ForgeConfig, logger } from "@feature-forge/shared";
import type { DisplayContribution, DisplayContributionRegistry } from "@feature-forge/tui";

import type { SubprocessAgent } from "../../agents/agents/SubprocessAgent";
import type { SpecManager } from "../../agents/SpecManager";
import type { AgentSupervisor } from "../../agents/supervisors/AgentSupervisor";
import type { TypedEventBus } from "../eventBus";
import { emitAgentDone, emitAgentStarted, emitAgentStream } from "../eventBus/agentChannels";
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

    emitAgentStarted(eventBus, {
      executionId,
      agentId: agent.id,
      name: instructionId,
      label: instruction.systemPrompt,
    });

    const emitStreamEvent = (event: JsonAgentSessionEvent): void => {
      emitAgentStream(eventBus, {
        executionId,
        agentId: agent.id,
        name: instructionId,
        label: specification.role,
        event,
      });
    };

    try {
      await agent.executeTask(resolvedTask, {
        signal,
        onEvent: emitStreamEvent,
      });

      const raw = agent.getResult();

      // When JSON is required but missing, give the agent a chance to correct
      // itself before giving up. retry() re-uses the existing transport session
      // and updates the agent's result, so getResult() is re-read after each
      // attempt. Transport errors stop the loop early - the raw output stands.
      if (instruction.parseJson && !extractJson(raw)) {
        logger.info("Agent response missing JSON — starting retry", {
          instructionId,
          resultLength: raw.length,
        });

        const correctionPrompt =
          "Your last response was missing the required JSON outcome block. " +
          "Review the output format instructions in your system prompt and " +
          "append the JSON block as specified there.";

        const maxRetries =
          instruction.maxJsonRetries ?? ForgeConfig.getInstance().getJsonRetryMaxAttempts();
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          logger.info("Agent JSON retry attempt", {
            instructionId,
            attempt: attempt + 1,
            maxRetries,
          });
          try {
            // Forward the abort signal so retries stay cancellable, matching
            // the initial task execution. Also forward onEvent so the TUI
            // shows streaming activity during retry instead of appearing stuck.
            await agent.retry(correctionPrompt, {
              signal,
              onEvent: emitStreamEvent,
            });
          } catch (error) {
            // Transport errors stop the retry loop early - the raw output
            // stands - but log the reason so failures stay diagnosable.
            logger.warn("Agent retry failed, falling back to original output", {
              instructionId,
              error,
            });
            break;
          }
          if (extractJson(agent.getResult())) {
            logger.info("Agent JSON retry succeeded", {
              instructionId,
              attempt: attempt + 1,
            });
            break; // Got valid JSON, stop retrying
          }
        }
      }

      logger.info("Agent completed", { instructionId, resultLength: agent.getResult().length });

      const result = this.buildResult(agent.getResult(), instruction.parseJson);
      const updatedContext = context.withResult(instructionId, result);

      const agentPassed = result.parsed?.passed;
      const agentSummary = result.parsed?.summary;
      emitAgentDone(eventBus, {
        executionId,
        agentId: agent.id,
        name: instructionId,
        summary: agentSummary,
        passed: agentPassed,
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
      emitAgentDone(eventBus, {
        executionId,
        agentId: agent.id,
        name: instructionId,
        passed: false,
        summary: failureSummary,
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
    const agentStatus =
      event.phase === "agent-started"
        ? "started"
        : event.phase === "agent-done"
          ? "done"
          : "running";
    const details = event.details as {
      executionId?: string;
      agentId: string;
      summary?: string;
      passed?: boolean;
      event?: JsonAgentSessionEvent;
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
    if (!parsed) {
      return {
        raw,
        parsed: {
          passed: false,
          summary: "Agent did not produce valid JSON output",
        },
      };
    }
    return { raw, parsed };
  }
}
