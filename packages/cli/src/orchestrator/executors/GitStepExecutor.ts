import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { logger } from "@feature-forge/shared";
import type { TypedEventBus } from "../eventBus";
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
    _executeStep: (
      instruction: FlowInstruction,
      context: FlowContext,
      signal?: AbortSignal,
    ) => Promise<FlowContext>,
    eventBus: TypedEventBus,
    signal?: AbortSignal,
  ): Promise<FlowContext> {
    signal?.throwIfAborted();

    const resolvedCwd = context.resolve(instruction.cwd);

    logger.info("Executing git step", {
      instructionId: instruction.id,
      action: instruction.action,
      cwd: resolvedCwd,
    });

    logger.debug("git-start", {
      phase: "git-start",
      message: `Git "${instruction.id}": ${instruction.action} in ${resolvedCwd}`,
    });

    eventBus.emit("feature-forge:git-start", {
      phase: "git-start",
      message: `Git "${instruction.id}": ${instruction.action} in ${resolvedCwd}`,
      details: {},
    });

    let raw: string;
    try {
      if (instruction.action === "add-and-commit") {
        const message =
          instruction.message !== undefined
            ? context.resolve(instruction.message)
            : "feature-forge: automated changes";
        // NOTE: add-and-commit failures are deliberately **re-thrown** rather
        // than captured as a soft `passed:false` result. This asymmetry is
        // intentional and documented in ADR 0008:
        //   - `add-and-commit` is the precondition for every subsequent step
        //     in `open_pr` (`push-current`, the `gh` step). If the commit
        //     never landed, pushing the branch would publish an empty/stale
        //     tree and `gh pr create` would open a misleading PR. A hard
        //     throw here lets {@link RoutineExecutor} abort the whole
        //     routine *before* those follow-up steps run.
        //   - `push-current`, by contrast, stays soft: a failed push may be
        //     retryable / network-related, and reporting it as
        //     `passed:false` keeps the `gh` step from crashing the routine
        //     on transient remote errors (the catch-block below still
        //     records the failure in the result for the orchestrator to
        //     surface).
        await GitStepExecutor.addAndCommit(resolvedCwd, this.timeout, message, signal);
        raw = JSON.stringify({ action: instruction.action, cwd: resolvedCwd, message });
      } else {
        const output = await GitStepExecutor.pushCurrent(resolvedCwd, this.timeout, signal);
        raw =
          `${output.stdout}${output.stderr}`.trim() ||
          JSON.stringify({ action: instruction.action, cwd: resolvedCwd });
      }

      const result: InstructionResult = {
        raw,
        parsed: {
          passed: true,
          summary: `Git ${instruction.action} completed in ${resolvedCwd}`,
        },
      };

      logger.debug("git-done", {
        phase: "git-done",
        message: `Git "${instruction.id}": ${instruction.action} complete`,
      });

      eventBus.emit("feature-forge:git-done", {
        phase: "git-done",
        message: `Git "${instruction.id}": ${instruction.action} complete`,
        details: { passed: true, summary: result.parsed?.summary ?? result.raw },
      });

      return context.withResult(instruction.id, result);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      logger.error("Git step failed", {
        instructionId: instruction.id,
        action: instruction.action,
        cwd: resolvedCwd,
        error: err,
      });

      // add-and-commit is a hard failure — never soft-capture it. See the
      // JSDoc above and ADR 0008.
      if (instruction.action === "add-and-commit") {
        throw err;
      }

      logger.debug("git-done", {
        phase: "git-done",
        message: `Git "${instruction.id}": ${instruction.action} failed`,
      });

      eventBus.emit("feature-forge:git-done", {
        phase: "git-done",
        message: `Git "${instruction.id}": ${instruction.action} failed`,
        details: { passed: false, summary: err.message },
      });

      const result: InstructionResult = {
        raw: err.message,
        parsed: {
          passed: false,
          summary: `Git ${instruction.action} failed: ${err.message}`,
        },
      };

      return context.withResult(instruction.id, result);
    }
  }

  private static async addAndCommit(
    cwd: string,
    timeout: number,
    message: string,
    signal?: AbortSignal,
  ): Promise<void> {
    // Stage all changes (including untracked files).
    await execFileAsync("git", ["add", "-A"], { cwd, timeout, signal });

    // Commit with the resolved message. When the tree has already been
    // committed (idempotent re-run), "nothing to commit" is not a real
    // failure — we verify HEAD exists and return silently. A truly empty
    // branch (no prior commits) re-throws as before.
    try {
      await execFileAsync("git", ["commit", "-m", message], { cwd, timeout, signal });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const stderrText = (error as { stderr?: string }).stderr ?? err.message;
      if (/nothing to commit/.test(stderrText)) {
        try {
          await execFileAsync("git", ["rev-parse", "--verify", "HEAD"], {
            cwd,
            timeout,
            signal,
          });
          return;
        } catch {
          throw err;
        }
      }
      throw err;
    }
  }

  private static async pushCurrent(
    cwd: string,
    timeout: number,
    signal?: AbortSignal,
  ): Promise<{ stdout: string; stderr: string }> {
    return await execFileAsync("git", ["push", "origin", "HEAD"], { cwd, timeout, signal });
  }
}
