import { randomUUID } from "node:crypto";

import type { EventBus } from "@earendil-works/pi-coding-agent";

import { WorkspaceHandle } from "../../workspace/WorkspaceHandle";
import { WorkspaceProviderRegistry } from "../../workspace/WorkspaceProviderRegistry";
import { WorktreeRegistry } from "../../workspace/WorktreeRegistry";
import type { FlowContext } from "../FlowContext";
import type { FlowInstruction, WorkspaceInstruction } from "../FlowInstruction";
import type { DisplayContribution } from "../progress/DisplayContribution";
import type { RoutineProgressEvent } from "../RoutineProgress";
import { StepExecutor } from "../StepExecutor";

/**
 * Executes a "workspace" instruction by creating an isolated workspace
 * via the configured {@link WorkspaceProviderRegistry}.
 *
 * After creation the workspace handle is stored in {@link FlowContext.workspaces}
 * so downstream instructions can resolve its path via `{{workspace.<name>}}`
 * and also registered in the persistent {@link WorktreeRegistry} so
 * commands like `/worktree:list` can surface it.
 */
export class WorkspaceStepExecutor extends StepExecutor<WorkspaceInstruction> {
  readonly type = "workspace";

  constructor(
    private readonly providerRegistry: WorkspaceProviderRegistry,
    private readonly worktreeRegistry: WorktreeRegistry,
  ) {
    super();
  }

  async execute(
    instruction: WorkspaceInstruction,
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

    const providerName = instruction.provider;
    const workspaceId = `ws-${randomUUID().split("-")[0]}`;

    const provider = this.providerRegistry.get(providerName);
    if (!provider) {
      throw new Error(`Unknown workspace provider "${providerName}"`);
    }

    const path = await provider.createWorkspace(workspaceId);
    const handle = new WorkspaceHandle(path, new Date());

    await this.worktreeRegistry.register(handle);

    eventBus.emit("feature-forge:workspace-ready", {
      phase: "workspace-ready",
      message: `Workspace "${workspaceId}" created at ${path}`,
      details: { workspace: path },
    });

    return context.withWorkspace("ws", handle).withResult("ws", {
      raw: JSON.stringify({ path }),
      parsed: { kind: "build", passed: true, summary: `Workspace created at ${path}` },
    });
  }

  /**
   * Extract workspace path from a workspace-ready event.
   */
  override getDisplayContribution(event: RoutineProgressEvent): DisplayContribution | undefined {
    if (event.phase !== "workspace-ready") {
      return undefined;
    }
    const workspace = event.details.workspace;
    if (typeof workspace !== "string") {
      return undefined;
    }
    return {
      workspace,
      phase: event.phase,
      message: event.message,
    };
  }
}
