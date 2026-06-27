import { logger } from "../../logging";
import type { FlowContext, InstructionResult } from "../FlowContext";
import type { GitInstruction } from "../FlowInstruction";
import { StepExecutor } from "../StepExecutor";

/**
 * Executes a "git" instruction by running git commands in a worktree.
 *
 * Supports two actions:
 * - **add-and-commit** — stages all changes and creates a commit.
 * - **push-current** — pushes the current branch to origin.
 *
 * The working directory is resolved from {@link GitInstruction.cwd},
 * which supports `{{workspace.<name>}}` templates via
 * {@link FlowContext.resolve}.
 */
export class GitStepExecutor extends StepExecutor<GitInstruction> {
  readonly type = "git";

  async execute(instruction: GitInstruction, context: FlowContext): Promise<FlowContext> {
    // TODO: Use execFile from node:child_process to run git commands.
    // 1. Resolve instruction.cwd via context.resolve().
    // 2. Run the appropriate git command based on instruction.action.
    // 3. Capture stdout/stderr.
    // 4. Return context.withResult(instructionId, result).

    const resolvedCwd = context.resolve(instruction.cwd);
    logger.info("Git step (TODO — stub)", {
      instructionId: instruction.id,
      action: instruction.action,
      cwd: resolvedCwd,
    });

    const result: InstructionResult = {
      raw: JSON.stringify({ action: instruction.action, cwd: resolvedCwd }),
      parsed: {
        kind: "build",
        passed: true,
        summary: `Git ${instruction.action} completed (stub) in ${resolvedCwd}`,
      },
    };

    return context.withResult(instruction.id, result);
  }
}
