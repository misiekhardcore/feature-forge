import type { AgentSupervisor } from "../../agents/supervisors/AgentSupervisor";
import { logger } from "../../logging";
import type { FlowContext, InstructionResult } from "../FlowContext";
import type { AgentInstruction } from "../FlowInstruction";
import { StepExecutor } from "../StepExecutor";

/**
 * Executes an "agent" instruction by spawning an agent via
 * {@link AgentSupervisor}, executing the task, collecting the result,
 * and destroying the agent.
 *
 * Resolves `{{PLACEHOLDER}}` tokens in the instruction's `task` field
 * before passing to the agent.
 */
export class AgentStepExecutor extends StepExecutor<AgentInstruction> {
  readonly type = "agent";

  constructor(private readonly supervisor: AgentSupervisor) {
    super();
  }

  async execute(instruction: AgentInstruction, context: FlowContext): Promise<FlowContext> {
    // TODO: Implement agent execution via AgentSupervisor.
    // 1. Resolve spec from instruction.spec (using SpecManager).
    // 2. Resolve placeholders in instruction.task via context.resolve().
    // 3. Spawn agent via supervisor.spawn(specification).
    // 4. Execute task via agent.executeTask(resolvedTask).
    // 5. Get result via agent.getResult().
    // 6. Destroy agent via supervisor.destroyAgent(agent.id).
    // 7. If instruction.parseJson is true, parse result.raw as JSON and
    //    extract .passed from it when building InstructionResult.parsed.
    // 8. Return context.withResult(instructionId, result).

    const instructionId = instruction.id;
    logger.warn("AgentStepExecutor not yet implemented — returning placeholder", {
      instructionId,
    });

    const placeholderResult: InstructionResult = {
      raw: `Agent "${instructionId}" task: ${instruction.task}`,
    };

    return context.withResult(instructionId, placeholderResult);
  }
}
