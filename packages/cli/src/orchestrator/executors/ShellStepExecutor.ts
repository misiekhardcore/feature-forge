import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { EventBus } from "@earendil-works/pi-coding-agent";

import { logger } from "../../logging";
import type { FlowContext, InstructionResult } from "../FlowContext";
import type { FlowInstruction, ShellInstruction } from "../FlowInstruction";
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

  async execute(
    instruction: ShellInstruction,
    context: FlowContext,
    _executeStep: (
      instruction: FlowInstruction,
      context: FlowContext,
      signal?: AbortSignal,
    ) => Promise<FlowContext>,
    eventBus: EventBus,
    signal?: AbortSignal,
  ): Promise<FlowContext> {
    signal?.throwIfAborted();

    const resolvedCommand = context.resolve(instruction.command);
    const resolvedCwd = context.resolve(instruction.cwd);

    logger.info("Executing shell step", {
      instructionId: instruction.id,
      command: resolvedCommand,
      cwd: resolvedCwd,
    });

    eventBus.emit("feature-forge:shell-start", {
      phase: "shell-start",
      message: `Shell "${instruction.id}": ${resolvedCommand}`,
      details: {},
    });

    try {
      const { stdout, stderr } = await execFileAsync("/bin/sh", ["-c", resolvedCommand], {
        cwd: resolvedCwd,
        timeout: this.timeout,
        maxBuffer: 10 * 1024 * 1024,
        signal,
      });

      const output = (stdout + (stderr ? `\nstderr:\n${stderr}` : "")).trim();

      const result: InstructionResult = {
        raw: output,
        parsed: {
          passed: true,
          summary: `Shell command completed: ${resolvedCommand}`,
        },
      };

      const updatedContext = context.withResult(instruction.id, result);

      eventBus.emit("feature-forge:shell-done", {
        phase: "shell-done",
        message: `Shell "${instruction.id}" completed`,
        details: {},
      });

      return updatedContext;
    } catch (error) {
      // execFile rejects on non-zero exit codes — capture stdout/stderr from the error.
      const err = error instanceof Error ? error : new Error(String(error));
      const stdoutOutput = (error as { stdout?: string }).stdout ?? "";
      const stderrOutput = (error as { stderr?: string }).stderr ?? "";
      const raw =
        (stdoutOutput + (stderrOutput ? `\nstderr:\n${stderrOutput}` : "")).trim() || err.message;

      logger.error("Shell step failed", {
        instructionId: instruction.id,
        command: resolvedCommand,
        cwd: resolvedCwd,
        error: err,
      });

      const failureResult: InstructionResult = {
        raw: raw,
        parsed: {
          passed: false,
          summary: `Shell command failed: ${resolvedCommand}`,
        },
      };

      return context.withResult(instruction.id, failureResult);
    }
  }
}
