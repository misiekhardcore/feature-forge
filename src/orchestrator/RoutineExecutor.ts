import { FlowContext, type InstructionResult } from "./FlowContext";
import type { FlowDefinition, FlowInstruction, Routine } from "./FlowInstruction";
import { isParsedResultPassed, type RoutineResult } from "./RoutineResult";
import type { StepExecutorRegistry } from "./StepExecutorRegistry";

/**
 * Executes one named routine from a flow definition to completion.
 *
 * Takes a routine name and parameter values, runs every step in the
 * routine's `steps` array against an immutable FlowContext, and returns
 * a structured RoutineResult blob the orchestrator LLM ingests.
 *
 * Depends only on the StepExecutorRegistry for step execution — no
 * knowledge of pi, the LLM, or the command system.
 */
export class RoutineExecutor {
  constructor(
    private readonly flow: FlowDefinition,
    private readonly stepExecutorRegistry: StepExecutorRegistry,
  ) {}

  /**
   * Run one routine and return its result.
   *
   * @param routineName — key in flow.routines (e.g. "run_build_loop")
   * @param params     — name→value map matching the routine's declared params
   * @throws if the routine is not found or a step type has no registered executor
   */
  async run(routineName: string, params: Record<string, string>): Promise<RoutineResult> {
    const routine = this.flow.routines[routineName];
    if (!routine) {
      throw new Error(`Routine "${routineName}" not found in flow "${this.flow.name}"`);
    }

    const context = new FlowContext(
      new Map(),
      params.task ?? "",
      params.plan ?? "",
      params.workspace,
    );

    let currentCtx = context;

    const executeStep = async (
      instruction: FlowInstruction,
      ctx: FlowContext,
    ): Promise<FlowContext> => {
      const executor = this.stepExecutorRegistry.find(instruction.type);
      if (!executor) {
        throw new Error(`No step executor registered for type: "${instruction.type}"`);
      }
      return executor.execute(instruction, ctx, executeStep);
    };

    for (const step of routine.steps) {
      currentCtx = await executeStep(step, currentCtx);
    }

    return RoutineExecutor.buildResult(routineName, routine, currentCtx);
  }

  /**
   * Build a RoutineResult from the final context state.
   */
  static buildResult(routineName: string, _routine: Routine, context: FlowContext): RoutineResult {
    const results: Record<string, InstructionResult> = {};
    for (const [id, result] of context.results) {
      results[id] = result;
    }

    const allPassed = [...context.results.values()].every((r) =>
      r.parsed ? isParsedResultPassed(r.parsed) : true,
    );

    return {
      routine: routineName,
      passed: allPassed,
      rounds: context.iteration > 0 ? context.iteration + 1 : undefined,
      workspace: context.workspace,
      results,
      summary: RoutineExecutor.summarize(routineName, allPassed, context),
    };
  }

  private static summarize(routineName: string, passed: boolean, context: FlowContext): string {
    const resultCount = context.results.size;
    const rounds = context.iteration > 0 ? ` after ${context.iteration + 1} rounds` : "";
    const verdict = passed ? "passed" : "failed";
    return `Routine "${routineName}" ${verdict}${rounds} (${resultCount} result${resultCount !== 1 ? "s" : ""}).`;
  }
}
