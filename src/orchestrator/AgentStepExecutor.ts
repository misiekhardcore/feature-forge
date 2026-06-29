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
export class AgentStepExecutor extends StepExecutor<AgentInstruction> {
  readonly type = "agent";

  constructor(
    private readonly supervisor: AgentSupervisor,
    private readonly specManager: SpecManager,
  ) {
    super();
  }

  override async execute(
    instruction: AgentInstruction,
    context: FlowContext,
    _executeStep: (instruction: FlowInstruction, context: FlowContext) => Promise<FlowContext>,
  ): Promise<FlowContext> {
    const resolvedTask = context.resolve(instruction.task);

    // Build specParams from specInput (resolved) or fall back to defaults.
    const specParams: Record<string, string> = instruction.specInput
      ? Object.fromEntries(
          Object.entries(instruction.specInput).map(([key, value]) => [
            key,
            context.resolve(value),
          ]),
        )
      : {
          TASK: resolvedTask,
          WORKSPACE: context.workspace ?? "",
          FEEDBACK: context.feedback ?? "",
          CONTEXT: [context.task, context.plan].filter(Boolean).join("\n"),
        };

    const spec = this.specManager.resolve({
      spec: instruction.spec,
      toolNames: [],
      specParams,
    });

    const agent = await this.supervisor.spawn(spec);
    let raw: string;
    try {
      raw = await agent.executeTask(resolvedTask);
    } finally {
      await this.supervisor.destroyAgent(agent.id);
    }

    let parsed: ParsedResult | undefined;
    if (instruction.parseJson) {
      parsed = extractJson(raw);
    }

    const result: InstructionResult = { raw };
    if (parsed) {
      result.parsed = parsed;
    }

    return context.withResult(instruction.id, result);
  }
}
