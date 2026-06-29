import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { logger } from "../../logging";
import type { FlowContext, InstructionResult } from "../FlowContext";
import type { FlowInstruction, GitInstruction } from "../FlowInstruction";
import { StepExecutor } from "../StepExecutor";

const execFileAsync = promisify(execFile);

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

  /** Maximum time (ms) a git command may run before being aborted. */
  private readonly timeout = 60_000;

  async execute(
    instruction: GitInstruction,
    context: FlowContext,
    _executeStep: (instruction: FlowInstruction, context: FlowContext) => Promise<FlowContext>,
  ): Promise<FlowContext> {
    const resolvedCwd = context.resolve(instruction.cwd);
    logger.info("Executing git step", {
      instructionId: instruction.id,
      action: instruction.action,
      cwd: resolvedCwd,
    });

    try {
      let raw: string;
      if (instruction.action === "add-and-commit") {
        const message =
          instruction.message !== undefined
            ? context.resolve(instruction.message)
            : "feature-forge: automated changes";
        await GitStepExecutor.addAndCommit(resolvedCwd, this.timeout, message);
        raw = JSON.stringify({ action: instruction.action, cwd: resolvedCwd, message });
      } else {
        const output = await GitStepExecutor.pushCurrent(resolvedCwd, this.timeout);
        raw =
          `${output.stdout}${output.stderr}`.trim() ||
          JSON.stringify({ action: instruction.action, cwd: resolvedCwd });
      }

      const result: InstructionResult = {
        raw,
        parsed: {
          kind: "build",
          passed: true,
          summary: `Git ${instruction.action} completed in ${resolvedCwd}`,
        },
      };

      return context.withResult(instruction.id, result);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      logger.error("Git step failed", {
        instructionId: instruction.id,
        action: instruction.action,
        cwd: resolvedCwd,
        error: err,
      });

      const result: InstructionResult = {
        raw: err.message,
        parsed: {
          kind: "build",
          passed: false,
          summary: `Git ${instruction.action} failed: ${err.message}`,
        },
      };

      return context.withResult(instruction.id, result);
    }
  }

  private static async addAndCommit(cwd: string, timeout: number, message: string): Promise<void> {
    // Stage all changes (including untracked files).
    await execFileAsync("git", ["add", "-A"], { cwd, timeout });

    // Commit with the resolved message.
    await execFileAsync("git", ["commit", "-m", message], { cwd, timeout });
  }

  private static async pushCurrent(
    cwd: string,
    timeout: number,
  ): Promise<{ stdout: string; stderr: string }> {
    return await execFileAsync("git", ["push", "origin", "HEAD"], { cwd, timeout });
  }
}
