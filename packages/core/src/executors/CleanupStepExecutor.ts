import { logger } from "@feature-forge/core";
import type { FlowContext, InstructionResult } from "@feature-forge/core/src/flows/FlowContext";
import type {
  CleanupInstruction,
  FlowInstruction,
} from "@feature-forge/core/src/flows/FlowInstruction";
import type { DisplayContribution } from "@feature-forge/core/src/progress/DisplayContribution";
import type { DisplayContributionRegistry } from "@feature-forge/core/src/progress/DisplayContributionRegistry";
import type { RoutineProgressEvent } from "@feature-forge/core/src/routines/RoutineProgress";
import type {
  WorkspaceManager,
  WorkspaceProviderRegistry,
  WorktreeRegistry,
} from "@feature-forge/core/src/workspace";
import type { WorkspaceHandle } from "@feature-forge/core/src/workspace/WorkspaceHandle";

import type { TypedEventBus } from "../event-bus";
import { StepExecutor } from "./StepExecutor";

/**
 * Executes a "cleanup" instruction by destroying named workspaces.
 *
 * If {@link CleanupInstruction.of} is provided, only that workspace is
 * destroyed (resolved against the context to a workspace id or path).
 * If omitted, all workspaces tracked in {@link FlowContext.workspaces}
 * are destroyed.
 *
 * Best-effort: individual workspace destruction failures are logged but
 * do not stop the routine. Successfully destroyed workspaces are also
 * removed from the persistent {@link WorktreeRegistry} and untracked
 * from the session-scoped path set.
 */
export class CleanupStepExecutor extends StepExecutor<CleanupInstruction> {
  readonly type = "cleanup";

  constructor(
    private readonly providerRegistry: WorkspaceProviderRegistry,
    private readonly worktreeRegistry: WorktreeRegistry,
    private readonly workspaceManager: WorkspaceManager,
  ) {
    super();
  }

  async execute(
    instruction: CleanupInstruction,
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

    eventBus.emit("feature-forge:cleanup-start", {
      phase: "cleanup-start",
      message: `Cleanup "${instruction.id}" starting`,
      details: {},
    });

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

      const branch = handle?.branch ?? this.findHandleByPath(path, context.workspaces)?.branch;
      await this.destroyPath(path, branch, this.providerRegistry);
      await this.worktreeRegistry.remove(path);
      this.workspaceManager.untrackPath(path);
      cleaned.push(targetName);
    } else {
      logger.info("Cleanup step — destroying all workspaces", {
        instructionId: instruction.id,
        workspaceCount: context.workspaces.size,
      });

      for (const [name, handle] of context.workspaces) {
        try {
          await this.destroyPath(handle.path, handle.branch, this.providerRegistry);
          await this.worktreeRegistry.remove(handle.path);
          this.workspaceManager.untrackPath(handle.path);
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
        passed: true,
        summary: `Cleanup completed: ${cleaned.length} workspace(s)`,
      },
    };

    const updatedContext = context.withResult(instruction.id, result);

    eventBus.emit("feature-forge:cleanup-done", {
      phase: "cleanup-done",
      message: `Cleanup "${instruction.id}" done — ${cleaned.length} workspace(s)`,
      details: {
        workspace: cleaned.length > 0 ? cleaned[0] : undefined,
      },
    });

    return updatedContext;
  }

  private async destroyPath(
    path: string,
    branch: string | undefined,
    registry: WorkspaceProviderRegistry,
  ): Promise<void> {
    const errors: Error[] = [];
    for (const providerName of registry.names()) {
      const provider = registry.get(providerName);
      if (!provider) continue;
      try {
        await provider.destroyWorkspace(path, branch);
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

  private findHandleByPath(
    path: string,
    workspaces: ReadonlyMap<string, WorkspaceHandle>,
  ): WorkspaceHandle | undefined {
    for (const handle of workspaces.values()) {
      if (handle.path === path) return handle;
    }
    return undefined;
  }

  /**
   * Extract display contribution from a cleanup-done event.
   */
  override registerDisplayHandler(registry: DisplayContributionRegistry): void {
    registry.register("status", (state, contribution) => {
      if (contribution.type !== "status") return;
      if (contribution.workspace !== undefined) {
        state.workspace = contribution.workspace;
      }
    });
  }

  override getDisplayContribution(event: RoutineProgressEvent): DisplayContribution | undefined {
    if (event.phase !== "cleanup-done") {
      return undefined;
    }
    const workspace = event.details.workspace;
    return {
      type: "status",
      phase: event.phase,
      message: event.message,
      ...(typeof workspace === "string" ? { workspace } : {}),
    };
  }
}
