import type { SpecManager } from "../agents/SpecManager";
import type { AgentSupervisor } from "../agents/supervisors/AgentSupervisor";
import { extractJson } from "./extractJson";
import type { FlowContext, InstructionResult, ParsedResult } from "./FlowContext";
import type { AgentInstruction, FlowInstruction } from "./FlowInstruction";
import { StepExecutor } from "./StepExecutor";

/**
 * Executes an `agent` instruction by spawning a sub-agent, sending the
 * resolved task, capturing the result, and destroying the agent.
 *
 * When `parseJson: true` is configured, a JSON fenced block is extracted
 * from the agent's raw output and stored as `parsed`.
 */
export class AgentStepExecutor extends StepExecutor {
  readonly type = "agent";

  constructor(
    private readonly supervisor: AgentSupervisor,
    private readonly specManager: SpecManager,
  ) {
    super();
  }

  override async execute(
    instruction: FlowInstruction,
    context: FlowContext,
    _executeStep: (instruction: FlowInstruction, context: FlowContext) => Promise<FlowContext>,
  ): Promise<FlowContext> {
    const agentInstruction = instruction as AgentInstruction;

    const resolvedTask = context.resolve(agentInstruction.task);

    const spec = this.specManager.resolve({
      spec: agentInstruction.spec,
      toolNames: [],
      specParams: {
        TASK: resolvedTask,
        WORKSPACE: context.workspace ?? "",
        FEEDBACK: context.feedback ?? "",
        CONTEXT: [context.task, context.plan].filter(Boolean).join("\n"),
      },
    });

    const agent = await this.supervisor.spawn(spec);
    let raw: string;
    try {
      raw = await agent.executeTask(resolvedTask);
    } finally {
      await this.supervisor.destroyAgent(agent.id);
    }

    let parsed: ParsedResult | undefined;
    if (agentInstruction.parseJson) {
      parsed = extractJson(raw);
    }

    const result: InstructionResult = { raw };
    if (parsed) {
      result.parsed = parsed;
    }

    return context.withResult(agentInstruction.id, result);
  }
}
