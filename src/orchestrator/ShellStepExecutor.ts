import { exec } from "node:child_process";
import { promisify } from "node:util";

import type { FlowContext } from "./FlowContext";
import type { FlowInstruction, ShellInstruction } from "./FlowInstruction";
import { StepExecutor } from "./StepExecutor";

const execAsync = promisify(exec);

/**
 * Executes a `shell` instruction by running the given command in a child
 * process and capturing stdout / stderr as the result.
 *
 * Template placeholders in the `command` and `cwd` fields are resolved
 * through FlowContext before execution.
 *
 * The internal `_execAsync` dependency is overridable for testing.
 */
export class ShellStepExecutor extends StepExecutor<ShellInstruction> {
  readonly type = "shell";

  private readonly _execAsync: typeof execAsync;

  constructor() {
    super();
    this._execAsync = execAsync;
  }

  override async execute(
    instruction: ShellInstruction,
    context: FlowContext,
    _executeStep: (instruction: FlowInstruction, context: FlowContext) => Promise<FlowContext>,
  ): Promise<FlowContext> {
    const resolvedCommand = context.resolve(instruction.command);
    const resolvedCwd = instruction.cwd ? context.resolve(instruction.cwd) : context.workspace;

    try {
      const { stdout, stderr } = await this._execAsync(resolvedCommand, {
        cwd: resolvedCwd,
        timeout: 30_000,
      });
      const raw = stderr ? `${stdout}\n${stderr}` : stdout;
      return context.withResult(instruction.id, { raw });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return context.withResult(instruction.id, { raw: `Command failed: ${message}` });
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
