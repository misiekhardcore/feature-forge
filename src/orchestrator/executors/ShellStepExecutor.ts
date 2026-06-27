import { logger } from "../../logging";
import type { FlowContext, InstructionResult } from "../FlowContext";
import type { ShellInstruction } from "../FlowInstruction";
import { StepExecutor } from "../StepExecutor";

/**
 * Executes a "shell" instruction by running an arbitrary shell command
 * in a specified working directory.
 *
 * The command string supports `{{PLACEHOLDER}}` templates resolved via
 * {@link FlowContext.resolve}. The working directory is resolved from
 * {@link ShellInstruction.cwd}.
 */
export class ShellStepExecutor extends StepExecutor<ShellInstruction> {
  readonly type = "shell";

  async execute(instruction: ShellInstruction, context: FlowContext): Promise<FlowContext> {
    // TODO: Use execFile from node:child_process to run the shell command.
    // 1. Resolve instruction.cwd via context.resolve().
    // 2. Resolve instruction.command via context.resolve().
    // 3. Execute the command with a reasonable timeout.
    // 4. Capture stdout/stderr.
    // 5. Return context.withResult(instructionId, result).

    const resolvedCommand = context.resolve(instruction.command);
    const resolvedCwd = context.resolve(instruction.cwd);
    logger.info("Shell step (TODO — stub)", {
      instructionId: instruction.id,
      command: resolvedCommand,
      cwd: resolvedCwd,
    });

    const result: InstructionResult = {
      raw: JSON.stringify({ command: resolvedCommand, cwd: resolvedCwd }),
      parsed: {
        kind: "build",
        passed: true,
        summary: `Shell command completed (stub): ${resolvedCommand}`,
      },
    };

    return context.withResult(instruction.id, result);
  }
}
