import { logger } from "../../logging";
import { WorkspaceProviderRegistry } from "../../workspace/WorkspaceProviderRegistry";
import type { FlowContext, InstructionResult } from "../FlowContext";
import type { CleanupInstruction, FlowInstruction } from "../FlowInstruction";
import { StepExecutor } from "../StepExecutor";

/**
 * Executes a "cleanup" instruction by destroying named workspaces.
 *
 * If {@link CleanupInstruction.of} is provided, only that workspace is
 * destroyed (resolved against the context to a workspace id or path).
 * If omitted, all workspaces tracked in {@link FlowContext.workspaces}
 * are destroyed.
 *
 * Best-effort: individual workspace destruction failures are logged but
 * do not stop the routine.
 */
export class CleanupStepExecutor extends StepExecutor<CleanupInstruction> {
  readonly type = "cleanup";

  constructor(private readonly providerRegistry: WorkspaceProviderRegistry) {
    super();
  }

  async execute(
    instruction: CleanupInstruction,
    context: FlowContext,
    _executeStep: (instruction: FlowInstruction, context: FlowContext) => Promise<FlowContext>,
  ): Promise<FlowContext> {
    const targetName = instruction.of ? context.resolve(instruction.of) : undefined;
    const cleaned: string[] = [];

    if (targetName) {
      // Try to resolve as workspace id in context, or treat as a raw path.
      const handle = context.workspaces.get(targetName);
      const path = handle?.path ?? targetName;

      logger.info("Cleanup step — destroying workspace", {
        instructionId: instruction.id,
        targetName,
        path,
      });

      await CleanupStepExecutor.destroyPath(path, this.providerRegistry);
      cleaned.push(targetName);
    } else {
      logger.info("Cleanup step — destroying all workspaces", {
        instructionId: instruction.id,
        workspaceCount: context.workspaces.size,
      });

      for (const [name, handle] of context.workspaces) {
        try {
          await CleanupStepExecutor.destroyPath(handle.path, this.providerRegistry);
          cleaned.push(name);
        } catch (error) {
          logger.error("Workspace destruction failed", {
            name,
            path: handle.path,
            error,
          });
        }
      }
    }

    const result: InstructionResult = {
      raw: JSON.stringify({ cleaned }),
      parsed: {
        kind: "build",
        passed: true,
        summary: `Cleanup completed: ${cleaned.length} workspace(s)`,
      },
    };

    return context.withResult(instruction.id, result);
  }

  private static async destroyPath(
    path: string,
    registry: WorkspaceProviderRegistry,
  ): Promise<void> {
    const errors: Error[] = [];
    for (const providerName of registry.names()) {
      const provider = registry.get(providerName);
      if (!provider) continue;
      try {
        await provider.destroyWorkspace(path);
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    if (errors.length > 0) {
      throw new Error(
        `Failed to destroy workspace at "${path}": ${errors.map((e) => e.message).join("; ")}`,
      );
    }
  }
}
