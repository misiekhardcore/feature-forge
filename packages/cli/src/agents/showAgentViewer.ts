import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { OverlayHandle } from "@earendil-works/pi-tui";
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
 *
 * The handle is a point-in-time snapshot, not a live reference: `viewer`
 * reflects the state at the moment of the call, so a caller that reused an
 * already-open overlay observes the snapshot that existed at reuse time
 * (see {@link showAgentViewer}).
 */
export interface AgentViewerHandle {
  /**
   * The opened overlay component — `undefined` whenever the call could not
   * (yet) expose one: for callers that reused while the overlay was still
   * opening (the factory had not run), and in headless mocks whose
   * `ui.custom` resolves without opening an overlay. The opening call's
   * handle receives the viewer once the factory has constructed it.
   */
  viewer?: AgentViewerOverlay;
  /**
   * Release event subscriptions, dispose the viewer, and dismiss the overlay.
   * Idempotent. A no-op for callers that reused an already-open overlay —
   * the opener retains lifecycle ownership.
   */
  dispose: () => void;
}

/** No-op dispose handed to callers that reused an already-open overlay. */
const noopDispose = (): void => {};

/** Module-level singleton: the currently open (or still opening) agent viewer. */
interface ActiveViewer {
  /** The constructed overlay component, once `ctx.ui.custom` has invoked the factory. */
  viewer?: AgentViewerOverlay;
  /** pi's overlay handle, once `ctx.ui.custom` reports it via `onHandle`. */
  overlayHandle?: OverlayHandle;
  /** Set when this entry has been torn down — it must never be reused. */
  disposed: boolean;
}

let activeViewer: ActiveViewer | undefined;

/**
 * Open the agent viewer overlay and own its full lifecycle:
 * wire overlay events → open via `ctx.ui.custom` → connect → dispose/dismiss.
 *
 * Only one overlay is ever open. While a viewer is open (or still opening),
 * a further invocation reuses it: the existing overlay is refocused via its
 * overlay handle and the caller receives the active viewer with a no-op
 * dispose — reuse never stacks a second overlay and never tears down an
 * overlay it did not open (its wiring, setup, and `onDismiss` params are
 * ignored; the opener keeps lifecycle ownership). The singleton is released
 * on dispose, on creation errors, and in headless mocks, so the invocation
 * after dismissal opens a fresh instance.
 *
 * The singleton lives at module scope in this file — it is process-global:
 * at most one overlay is ever open per process, which fits pi's single TUI
 * surface. If pi ever ran multiple session UIs in one process, this would
 * need per-`ctx` scoping. The reuse contract also assumes every caller
 * imports the same bundled module instance (all forge callers do:
 * `RoutineTool`, `AgentListCommand`, and the dev test commands in
 * `registerTestCommands`).
 *
 * The two resolution contracts differ. The opening call resolves once the
 * overlay is dismissed (or immediately in headless mocks whose `ui.custom`
 * never opens an overlay — in that case the wiring is released before
 * returning). A reusing call resolves immediately with a point-in-time
 * snapshot of the active viewer — it does not wait for dismissal — and its
 * {@link AgentViewerHandle.viewer} is `undefined` if the overlay was still
 * opening when the reuse landed (the factory had not run yet). Reusing
 * callers must not treat `viewer` as guaranteed, nor await the promise as a
 * dismissal signal. The handle's {@link AgentViewerHandle.dispose} is the
 * single cleanup path — it is wired to the overlay's own `onDone` and safe
 * to call multiple times.
 */
export async function showAgentViewer(params: ShowAgentViewerParams): Promise<AgentViewerHandle> {
  const { ctx, config, toolRegistry, eventBus, agentQuery, streamDir, setup, onDismiss } = params;

  // Singleton reuse: an open (or opening) viewer owns the overlay. Refocus it
  // (front + input reclaim) and hand the active viewer back under a no-op
  // dispose so the reusing caller's teardown cannot close the opener's
  // overlay — e.g. RoutineTool's finally always disposes its handle.
  if (activeViewer && !activeViewer.disposed) {
    activeViewer.overlayHandle?.focus();
    return { viewer: activeViewer.viewer, dispose: noopDispose };
  }

  // Claim the singleton synchronously, before `ctx.ui.custom` is awaited, so
  // a second invocation in the same tick observes the claim and reuses.
  const entry: ActiveViewer = { disposed: false };
  activeViewer = entry;

  const resolvedStreamDir = streamDir ?? SharedStreamDir.get(config.getLogDir());
  const unsubs: Array<() => void> = [];
  let viewerRef: AgentViewerOverlay | undefined;
  let dismiss: (() => void) | undefined;
  let disposed = false;

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    entry.disposed = true;
    if (activeViewer === entry) activeViewer = undefined;
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
        entry.viewer = viewer;
        setup?.(viewer);
        wiring?.connect(viewer, resolvedStreamDir);

        return viewer;
      },
      {
        overlay: true,
        overlayOptions: AgentViewerOverlay.getOverlayOptions(config),
        onHandle: (handle) => {
          entry.overlayHandle = handle;
        },
      },
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
