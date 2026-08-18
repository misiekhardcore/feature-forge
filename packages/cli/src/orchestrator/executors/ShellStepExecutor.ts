import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { promisify } from "node:util";

import { logger } from "@feature-forge/shared";
import type { DisplayContribution } from "@feature-forge/tui";

import type { TypedEventBus } from "../eventBus";
import type { FlowContext, InstructionResult } from "../FlowContext";
import type { FlowInstruction, ShellInstruction } from "../FlowInstruction";
import type { RoutineProgressEvent } from "../RoutineProgress";
import { StepExecutor } from "../StepExecutor";

const execFileAsync = promisify(execFile);

/** Maximum time (ms) a shell command may run before being aborted. */
const SHELL_TIMEOUT_MS = 120_000;
/** Maximum bytes of stdout/stderr buffered per shell command before failure. */
const SHELL_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

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
  private readonly timeout = SHELL_TIMEOUT_MS;

  async execute(
    instruction: ShellInstruction,
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

    const resolvedCommand = context.resolve(instruction.command);
    // cwd is optional: repo-independent commands (e.g. `gh api graphql` with
    // explicit owner/repo) run in the process working directory. When
    // provided, validate it before spawning — see assertCwd.
    const resolvedCwd =
      instruction.cwd === undefined ? undefined : context.resolve(instruction.cwd);
    if (resolvedCwd !== undefined) {
      ShellStepExecutor.assertCwd(instruction.id, resolvedCwd);
    }

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
        maxBuffer: SHELL_MAX_BUFFER_BYTES,
        signal,
      });

      const output = (stdout + (stderr ? `\nstderr:\n${stderr}` : "")).trim();

      // Extract GitHub PR URL from output if present
      const prUrlMatch = output.match(/https?:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/);
      const prUrl = prUrlMatch ? prUrlMatch[0] : undefined;

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
        details: {
          passed: true,
          summary: result.parsed?.summary ?? result.raw,
          ...(prUrl ? { prUrl } : {}),
        },
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

      // failFast mirrors the deliberate asymmetry established in ADR 0008:
      // steps that are preconditions for downstream steps must hard-fail so
      // RoutineExecutor aborts before subsequent steps (e.g. push, PR create)
      // execute against a broken state.
      if (instruction.failFast) {
        throw err;
      }

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

  /**
   * Validate the resolved working directory before spawning the shell.
   *
   * `execFile` reports a misleading `spawn /bin/sh ENOENT` when the cwd is
   * unusable — an unresolved `{{placeholder}}` (e.g. `{{workspace}}` before
   * `set_flow_param` was called) or a stale/missing path fails at spawn with
   * an error that points at the binary instead of the real cause. Fail with
   * an actionable message instead; an unusable cwd is a routine-protocol
   * error, not a command failure, so it always hard-fails (ADR 0008).
   */
  private static assertCwd(instructionId: string, cwd: string): void {
    const unresolved = cwd.match(/\{\{([^}]+)\}\}/);
    if (unresolved) {
      throw new Error(
        `Shell step "${instructionId}": working directory "${cwd}" contains an unresolved ` +
          `placeholder "${unresolved[0]}". Pass the routine parameter or set it first, e.g. ` +
          `set_flow_param(key="${unresolved[1].trim()}", value=<worktree path>) ` +
          `before running this routine.`,
      );
    }
    if (cwd.trim() === "") {
      throw new Error(
        `Shell step "${instructionId}": working directory is empty - provide the cwd parameter.`,
      );
    }
    if (!statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(
        `Shell step "${instructionId}": working directory "${cwd}" does not exist or is not a directory.`,
      );
    }
  }

  override getDisplayContribution(event: RoutineProgressEvent): DisplayContribution | undefined {
    if (event.phase !== "shell-done") {
      return undefined;
    }
    const prUrl = event.details.prUrl;
    if (typeof prUrl !== "string") {
      return undefined;
    }
    return {
      type: "status",
      phase: event.phase,
      message: prUrl,
    };
  }
}
