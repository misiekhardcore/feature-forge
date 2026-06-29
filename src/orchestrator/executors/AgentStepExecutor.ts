import type { SpecManager } from "../../agents/SpecManager";
import type { AgentSupervisor } from "../../agents/supervisors/AgentSupervisor";
import { logger } from "../../logging";
import type { FlowContext, InstructionResult } from "../FlowContext";
import type { AgentInstruction, FlowInstruction } from "../FlowInstruction";
import { StepExecutor } from "../StepExecutor";
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
  ): Promise<FlowContext> {
    const instructionId = instruction.id;

    // 1. Build the specification from the named spec registry.
    const specification = this.specManager.resolve({
      spec: instruction.systemPrompt,
    });

    // 2. Resolve the task template.
    const resolvedTask = context.resolve(instruction.task);

    logger.info("Spawning agent", {
      instructionId,
      spec: instruction.systemPrompt,
      task: resolvedTask.slice(0, 200),
    });

    // 3. Spawn agent, execute task, collect result, and destroy.
    const agent = await this.supervisor.spawn(specification);
    try {
      await agent.executeTask(resolvedTask);

      const raw = agent.getResult();
      logger.info("Agent completed", { instructionId, resultLength: raw.length });

      const result = AgentStepExecutor.buildResult(raw, instruction.parseJson);
      return context.withResult(instructionId, result);
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

  private static buildResult(raw: string, parseJson?: boolean): InstructionResult {
    if (!parseJson) {
      return { raw };
    }

    const parsed = extractJson(raw);
    return { raw, parsed };
  }
}
