import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { logger } from "@feature-forge/core";
import type { TypedEventBus } from "@feature-forge/core/event-bus";

import type { AgentQuery, AgentViewerConfigSource, ToolFormatter } from "./api";
import type { AgentViewerHandle } from "./showAgentViewer";
import { showAgentViewer } from "./showAgentViewer";

/** Constructor parameters for {@link AgentViewerLifecycle}. */
export interface AgentViewerLifecycleParams {
  /** Command context — the overlay opens via `ctx.ui.custom`. */
  ctx: ExtensionContext;
  /** Viewer configuration: display tuning plus log/stream-directory settings. */
  viewerConfig: AgentViewerConfigSource;
  /** Tool registry used by the detail view to restore tool argument formatting. */
  toolRegistry: ToolFormatter;
  /** Typed event bus feeding the overlay with live agent events. */
  eventBus: TypedEventBus;
  /** Agent query used to seed entries at connect time. */
  agentQuery: AgentQuery;
}

/**
 * One-shot lazy lifecycle for the agent viewer overlay.
 *
 * The overlay is opened lazily on the first agent progress event, not
 * eagerly, so routines without agent steps never create an overlay. The
 * open call is deliberately not awaited: `ctx.ui.custom` resolves only when
 * the overlay is dismissed, so awaiting would stall the routine until the
 * user closes it. The resolved handle is captured for {@link dispose} —
 * teardown stays with the composer (its onDone path / headless
 * self-dispose), so {@link dispose} is an idempotent safety net.
 */
export class AgentViewerLifecycle {
  private readonly params: AgentViewerLifecycleParams;
  private handle: AgentViewerHandle | undefined;
  private opened = false;

  constructor(params: AgentViewerLifecycleParams) {
    this.params = params;
  }

  /**
   * Open the agent viewer overlay, at most once per lifecycle. No-op when
   * the context has no UI surface or the viewer was already opened.
   */
  open(): void {
    if (!this.params.ctx.hasUI || this.opened) return;
    this.opened = true;
    void this.openViewer();
  }

  /** Create the overlay and capture its handle; failures are logged and swallowed. */
  private async openViewer(): Promise<void> {
    const { ctx, viewerConfig, toolRegistry, eventBus, agentQuery } = this.params;
    try {
      this.handle = await showAgentViewer({
        ctx,
        config: viewerConfig,
        toolRegistry,
        eventBus,
        agentQuery,
      });
    } catch (err) {
      logger.warn("Agent viewer overlay creation failed", { err });
    }
  }

  /**
   * Release the captured viewer handle. Idempotent: repeated calls (and
   * calls before the handle resolves) are no-ops.
   */
  dispose(): void {
    this.handle?.dispose();
    this.handle = undefined;
  }
}
