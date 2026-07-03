import type { EventBus } from "@earendil-works/pi-coding-agent";

import type { SubprocessAgent } from "../../agents/agents/SubprocessAgent";
import type { AgentSpecification } from "../../agents/specifications";
import type { SpecManager } from "../../agents/SpecManager";
import type { AgentSupervisor } from "../../agents/supervisors/AgentSupervisor";
import { logger } from "../../logging";
import type { FlowContext, InstructionResult } from "../FlowContext";
import type { AgentInstruction, FlowInstruction } from "../FlowInstruction";
import { StepExecutor } from "../StepExecutor";
import { AgentInstructionWorkingDirMissing } from "./AgentInstructionWorkingDirMissing";
import { extractJson } from "./extractJson";

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
    _executeStep: (instruction: FlowInstruction, context: FlowContext) => Promise<FlowContext>,
    eventBus: EventBus,
  ): Promise<FlowContext> {
    const instructionId = instruction.id;

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
    const effectiveSpecification = this.applyWorkingDir(specification, instruction, context);

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
      details: {},
    });

    try {
      await agent.executeTask(resolvedTask);

      const raw = agent.getResult();
      logger.info("Agent completed", { instructionId, resultLength: raw.length });

      const result = this.buildResult(raw, instruction.parseJson);
      const updatedContext = context.withResult(instructionId, result);

      eventBus.emit("feature-forge:agent-done", {
        phase: "agent-done",
        message: `Agent "${instructionId}" completed`,
        details: {},
      });

      return updatedContext;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error("Agent execution failed", { instructionId, error: err });

      const failureResult: InstructionResult = {
        raw: err.message,
        parsed: {
          kind: "build",
          passed: false,
          summary: `Agent "${instructionId}" failed: ${err.message}`,
        },
      };
      return context.withResult(instructionId, failureResult);
    } finally {
      await this.supervisor.destroyAgent(agent.id);
    }
  }

  /**
   * Resolve `instruction.workingDir` (if present) to a concrete path and
   * return a specification carrying that path as `cwd`.
   *
   * - `{ workspace: <name> }`: the name is template-resolved via the context
   *   and looked up through `context.getWorkspacePath`. Throws
   *   {@link AgentInstructionWorkingDirMissing} when the workspace is not
   *   available at runtime.
   * - `{ path: <p> }`: `<p>` is template-resolved and used verbatim.
   * - absent: the original specification is returned unchanged.
   *
   * The cwd is applied by reconstructing the specification as a
   * {@link DynamicAgentSpecification}, copying the resolved spec's public
   * fields and overriding `cwd`. This is the existing supported mechanism —
   * `AgentSpecification.cwd` is the field the agent factory reads when
   * spawning the subprocess — so no supervisor or factory changes are
   * required.
   */
  private applyWorkingDir(
    specification: AgentSpecification,
    instruction: AgentInstruction,
    context: FlowContext,
  ): AgentSpecification {
    const workingDir = instruction.workingDir;
    if (workingDir === undefined) {
      return specification;
    }

    const cwd = this.resolveWorkingDirPath(workingDir, context, instruction.id);
    return this.specManager.createDynamic({ ...specification, cwd });
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
