import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { ForgeConfig } from "@feature-forge/shared";
import type { AgentQuery, ToolFormatter } from "@feature-forge/tui";
import { AgentViewerOverlay } from "@feature-forge/tui";

import { TypedEventBus } from "../orchestrator/eventBus";
import { SharedStreamDir } from "../orchestrator/progress/sharedStreamDir";

/**
 * Parameters for {@link showAgentViewer}.
 */
export interface ShowAgentViewerParams {
  /** Command context — the overlay opens via `ctx.ui.custom`. */
  ctx: ExtensionContext;
  /** Display configuration (ForgeConfig satisfies the tui DisplayConfig contract). */
  config: ForgeConfig;
  /** Tool registry used by the detail view to restore tool argument formatting. */
  toolRegistry: ToolFormatter;
  /**
   * Typed event bus feeding the overlay with live agent events.
   * When omitted (or without {@link agentQuery}), event wiring is skipped —
   * test commands construct fully self-driven scenarios.
   */
  eventBus?: TypedEventBus;
  /** Agent query used to seed entries at connect time; required alongside {@link eventBus}. */
  agentQuery?: AgentQuery;
  /** Stream directory override; defaults to the session-shared stream directory. */
  streamDir?: string;
  /** Per-call viewer customization, applied after construction and before connect. */
  setup?: (viewer: AgentViewerOverlay) => void;
  /** Invoked when the overlay is dismissed. */
  onDismiss?: () => void;
}

/**
 * Handle returned by {@link showAgentViewer}.
 */
export interface AgentViewerHandle {
  /** The opened overlay component — undefined in headless mocks whose `ui.custom` resolves without opening one. */
  viewer?: AgentViewerOverlay;
  /** Release event subscriptions, dispose the viewer, and dismiss the overlay. Idempotent. */
  dispose: () => void;
}

/**
 * Open the agent viewer overlay and own its full lifecycle:
 * wire overlay events → open via `ctx.ui.custom` → connect → dispose/dismiss.
 *
 * Resolves once the overlay is dismissed (or immediately in headless mocks
 * whose `ui.custom` never opens an overlay — in that case the wiring is
 * released before returning). The handle's {@link AgentViewerHandle.dispose}
 * is the single cleanup path — it is wired to the overlay's own `onDone` and
 * safe to call multiple times.
 */
export async function showAgentViewer(params: ShowAgentViewerParams): Promise<AgentViewerHandle> {
  const { ctx, config, toolRegistry, eventBus, agentQuery, streamDir, setup, onDismiss } = params;

  const resolvedStreamDir = streamDir ?? SharedStreamDir.get(config.getLogDir());
  const unsubs: Array<() => void> = [];
  let viewerRef: AgentViewerOverlay | undefined;
  let dismiss: (() => void) | undefined;
  let disposed = false;

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    unsubs.forEach((unsub) => unsub());
    viewerRef?.dispose();
    dismiss?.();
    onDismiss?.();
  };

  // Subscribe before the overlay opens — wireOverlayEvents buffers
  // pre-open events and connect() replays them once the viewer exists.
  const wiring =
    eventBus && agentQuery
      ? AgentViewerOverlay.wireOverlayEvents({ eventBus, agentQuery, config, toolRegistry })
      : undefined;
  if (wiring) unsubs.push(...wiring.unsubs);

  await ctx.ui
    .custom<void>(
      (tui, theme, _kb, done) => {
        dismiss = done;

        const viewer = new AgentViewerOverlay({
          tui,
          theme,
          onDone: dispose,
          markdownTheme: getMarkdownTheme(),
          cwd: ctx.cwd,
          toolRegistry,
          config,
        });
        // Assign before setup/connect — a throw in either must still release
        // the constructed viewer from the catch path below.
        viewerRef = viewer;
        setup?.(viewer);
        wiring?.connect(viewer, resolvedStreamDir);

        return viewer;
      },
      { overlay: true, overlayOptions: AgentViewerOverlay.getOverlayOptions(config) },
    )
    .catch((err) => {
      // Creation failed — release anything already opened, then propagate
      // so callers keep their own error handling (e.g. debug logging).
      dispose();
      throw err;
    });

  // Headless mocks resolve `ui.custom` without ever invoking the factory —
  // no overlay exists, so release the wiring (and any onDismiss) ourselves.
  if (!viewerRef && !disposed) dispose();

  return { viewer: viewerRef, dispose };
}
