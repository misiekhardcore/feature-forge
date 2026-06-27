import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { logger } from "../../logging";
import type { FlowContext, InstructionResult } from "../FlowContext";
import type { ShellInstruction } from "../FlowInstruction";
import { StepExecutor } from "../StepExecutor";

const execFileAsync = promisify(execFile);

/**
 * Executes a "shell" instruction by running an arbitrary shell command
 * in a specified working directory via system shell (`/bin/sh -c`).
 *
 * The command string supports `{{PLACEHOLDER}}` templates resolved via
 * {@link FlowContext.resolve}. The working directory is resolved from
 * {@link ShellInstruction.cwd}.
 */
export class ShellStepExecutor extends StepExecutor<ShellInstruction> {
  readonly type = "shell";

  /** Maximum time (ms) a shell command may run before being aborted. */
  private readonly timeout = 120_000;

  async execute(instruction: ShellInstruction, context: FlowContext): Promise<FlowContext> {
    const resolvedCommand = context.resolve(instruction.command);
    const resolvedCwd = context.resolve(instruction.cwd);

    logger.info("Executing shell step", {
      instructionId: instruction.id,
      command: resolvedCommand,
      cwd: resolvedCwd,
    });

    try {
      const { stdout, stderr } = await execFileAsync("/bin/sh", ["-c", resolvedCommand], {
        cwd: resolvedCwd,
        timeout: this.timeout,
        maxBuffer: 10 * 1024 * 1024,
      });

      const output = (stdout + (stderr ? `\nstderr:\n${stderr}` : "")).trim();

      const result: InstructionResult = {
        raw: output,
        parsed: {
          kind: "build",
          passed: true,
          summary: `Shell command completed: ${resolvedCommand}`,
        },
      };

      return context.withResult(instruction.id, result);
    } catch (error) {
      // execFile rejects on non-zero exit codes — capture stdout/stderr from the error.
      const err = error instanceof Error ? error : new Error(String(error));
      const stderrOutput = (error as { stderr?: string }).stderr ?? "";

      logger.error("Shell step failed", {
        instructionId: instruction.id,
        command: resolvedCommand,
        cwd: resolvedCwd,
        error: err,
      });

      const result: InstructionResult = {
        raw: stderrOutput || err.message,
        parsed: {
          kind: "build",
          passed: false,
          summary: `Shell command failed: ${resolvedCommand}`,
        },
      };

      return context.withResult(instruction.id, result);
    }
  }
}
