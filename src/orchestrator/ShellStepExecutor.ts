import { exec } from "node:child_process";
import { promisify } from "node:util";

import type { FlowContext } from "./FlowContext";
import type { FlowInstruction } from "./FlowInstruction";
import { StepExecutor } from "./StepExecutor";

const execAsync = promisify(exec);

/**
 * Shape of a `shell` instruction.
 *
 * Runs an arbitrary shell command in the workspace directory (if set).
 * The command string supports FlowContext placeholder resolution.
 */
interface ShellInstruction {
  type: "shell";
  id: string;
  /** Shell command to execute (supports {{...}} placeholders). */
  command: string;
  /** Working directory for the command (optional, resolved via context). */
  cwd?: string;
}

/**
 * Executes a `shell` instruction by running the given command in a child
 * process and capturing stdout / stderr as the result.
 *
 * Template placeholders in the `command` and `cwd` fields are resolved
 * through FlowContext before execution.
 *
 * The internal `_execAsync` dependency is overridable for testing.
 */
export class ShellStepExecutor extends StepExecutor {
  readonly type = "shell";

  private readonly _execAsync: typeof execAsync;

  constructor() {
    super();
    this._execAsync = execAsync;
  }

  override async execute(
    instruction: FlowInstruction,
    context: FlowContext,
    _executeStep: (instruction: FlowInstruction, context: FlowContext) => Promise<FlowContext>,
  ): Promise<FlowContext> {
    const shellInstruction = instruction as unknown as ShellInstruction;

    const resolvedCommand = context.resolve(shellInstruction.command);
    const resolvedCwd = shellInstruction.cwd
      ? context.resolve(shellInstruction.cwd)
      : context.workspace;

    try {
      const { stdout, stderr } = await this._execAsync(resolvedCommand, {
        cwd: resolvedCwd,
        timeout: 30_000,
      });
      const raw = stderr ? `${stdout}\n${stderr}` : stdout;
      return context.withResult(shellInstruction.id, { raw });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return context.withResult(shellInstruction.id, { raw: `Command failed: ${message}` });
    }
  }
}

/**
 * Create a ShellStepExecutor with a custom exec implementation for testing.
 */
export function createShellStepExecutor(
  customExec: (
    command: string,
    options?: { cwd?: string; timeout?: number },
  ) => Promise<{ stdout: string; stderr: string }>,
): ShellStepExecutor {
  const executor = new ShellStepExecutor();
  (executor as unknown as { _execAsync: typeof execAsync })._execAsync =
    customExec as typeof execAsync;
  return executor;
}
