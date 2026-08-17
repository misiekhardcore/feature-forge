import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { OverlayHandle, TUI } from "@earendil-works/pi-tui";
import { ForgeConfig } from "@feature-forge/shared";
import type { AgentQuery } from "@feature-forge/tui";
import { AgentViewerOverlay } from "@feature-forge/tui";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SharedStreamDir } from "../orchestrator/progress/sharedStreamDir";
import { makeMockToolRegistry, makeMockTypedEventBus } from "../test-utils";
import { showAgentViewer } from "./showAgentViewer";

const config = {
  getLogDir: () => "/tmp/forge-test-streams",
  getDisplayMaxAgentEvents: () => 200,
  getDisplayMaxPreconnectBuffer: () => 100,
  getDisplayMaxOverlayHeight: () => "85%",
  getHideThinkingBlock: () => false,
} as unknown as ForgeConfig;

const STREAM_DIR = "/tmp/forge-test-streams";

/** Captures the `ctx.ui.custom` factory so tests can open/dismiss the overlay manually. */
function makeHarness(): {
  ctx: ExtensionContext;
  custom: ReturnType<typeof vi.fn>;
  openOverlay(): AgentViewerOverlay | undefined;
  dismissOverlay(): void;
  /** Invoke the `ui.custom` `onHandle` callback with a mock OverlayHandle, as pi does once the overlay is shown. */
  attachOverlayHandle(): OverlayHandle;
  /** Resolve the `ui.custom` promise without invoking the factory (headless mocks). */
  resolveWithoutOpening(): void;
  /** Reject the `ui.custom` promise, as pi does when the factory throws. */
  rejectCustom(err: unknown): void;
} {
  const custom = vi.fn();
  let factory:
    | ((tui: unknown, theme: unknown, kb: unknown, done: () => void) => unknown)
    | undefined;
  let customOptions: { onHandle?: (handle: OverlayHandle) => void } | undefined;
  let doneRef: (() => void) | undefined;
  let resolveCustom: (() => void) | undefined;
  let rejectCustom: ((err: unknown) => void) | undefined;

  custom.mockImplementation(
    (open: typeof factory, options?: { onHandle?: (handle: OverlayHandle) => void }) => {
      factory = open;
      customOptions = options;
      return new Promise<void>((resolve, reject) => {
        resolveCustom = resolve;
        rejectCustom = reject;
      });
    },
  );

  const ctx = {
    hasUI: true,
    cwd: "/tmp/forge-viewer",
    ui: {
      notify: vi.fn(),
      custom,
      confirm: vi.fn(),
      select: vi.fn(),
    },
  } as unknown as ExtensionContext;

  return {
    ctx,
    custom,
    openOverlay() {
      const tui = { requestRender: vi.fn() } as unknown as TUI;
      const theme = {
        fg: vi.fn((_color: string, text: string) => text),
        bg: vi.fn((_color: string, text: string) => text),
        bold: vi.fn((text: string) => text),
        italic: vi.fn((text: string) => text),
        inverse: vi.fn((text: string) => text),
      } as unknown as Theme;
      doneRef = vi.fn(() => resolveCustom?.());
      return factory?.(tui, theme, {}, doneRef) as AgentViewerOverlay | undefined;
    },
    dismissOverlay() {
      doneRef?.();
    },
    attachOverlayHandle() {
      const handle = {
        hide: vi.fn(),
        setHidden: vi.fn(),
        isHidden: vi.fn(() => false),
        focus: vi.fn(),
        unfocus: vi.fn(),
        isFocused: vi.fn(() => true),
      } as unknown as OverlayHandle;
      customOptions?.onHandle?.(handle);
      return handle;
    },
    resolveWithoutOpening() {
      resolveCustom?.();
    },
    rejectCustom(err) {
      rejectCustom?.(err);
    },
  };
}

function makeAgentQuery(): AgentQuery {
  return {
    getAgent: vi.fn(() => undefined),
    getAllAgents: vi.fn(() => []),
  };
}

describe("showAgentViewer", () => {
  const wireSpies: Array<ReturnType<typeof vi.spyOn>> = [];

  afterEach(() => {
    for (const spy of wireSpies) spy.mockRestore();
    wireSpies.length = 0;
  });

  function mockWiring(): { connect: ReturnType<typeof vi.fn>; unsub: ReturnType<typeof vi.fn> } {
    const spy = vi.spyOn(AgentViewerOverlay, "wireOverlayEvents");
    const connect = vi.fn();
    const unsub = vi.fn();
    spy.mockReturnValue({ connect, unsubs: [unsub] });
    wireSpies.push(spy);
    return { connect, unsub };
  }

  it("opens the overlay via ctx.ui.custom with standard overlay options", async () => {
    const harness = makeHarness();
    const promise = showAgentViewer({
      ctx: harness.ctx,
      config,
      toolRegistry: makeMockToolRegistry(),
      streamDir: STREAM_DIR,
    });

    const viewer = harness.openOverlay();

    expect(harness.custom).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        overlay: true,
        overlayOptions: expect.objectContaining({ anchor: "center", width: "100%" }),
      }),
    );
    expect(viewer).toBeInstanceOf(AgentViewerOverlay);

    harness.dismissOverlay();
    const handle = await promise;
    expect(handle.viewer).toBe(viewer);
    expect(handle.dispose).toBeTypeOf("function");
    handle.dispose();
  });

  it("wires overlay events and connects the viewer when eventBus and agentQuery are given", async () => {
    const { connect, unsub } = mockWiring();
    const harness = makeHarness();
    const eventBus = makeMockTypedEventBus();
    const agentQuery = makeAgentQuery();

    const promise = showAgentViewer({
      ctx: harness.ctx,
      config,
      toolRegistry: makeMockToolRegistry(),
      eventBus,
      agentQuery,
      streamDir: STREAM_DIR,
    });

    const viewer = harness.openOverlay();

    expect(AgentViewerOverlay.wireOverlayEvents).toHaveBeenCalledWith(
      expect.objectContaining({ eventBus, agentQuery, toolRegistry: expect.any(Object) }),
    );
    expect(connect).toHaveBeenCalledWith(viewer, STREAM_DIR);

    harness.dismissOverlay();
    const handle = await promise;

    // done() alone only resolves the ui.custom promise — dispose owns teardown.
    expect(unsub).not.toHaveBeenCalled();
    handle.dispose();
    expect(unsub).toHaveBeenCalledTimes(1);
    handle.dispose();
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it("skips event wiring when eventBus is omitted", async () => {
    const spy = vi.spyOn(AgentViewerOverlay, "wireOverlayEvents");
    wireSpies.push(spy);
    const harness = makeHarness();

    const promise = showAgentViewer({
      ctx: harness.ctx,
      config,
      toolRegistry: makeMockToolRegistry(),
      streamDir: STREAM_DIR,
    });

    harness.openOverlay();
    expect(spy).not.toHaveBeenCalled();

    harness.dismissOverlay();
    (await promise).dispose();
  });

  it("runs setup with the viewer before connect", async () => {
    const { connect } = mockWiring();
    const setup = vi.fn();
    const harness = makeHarness();

    const promise = showAgentViewer({
      ctx: harness.ctx,
      config,
      toolRegistry: makeMockToolRegistry(),
      eventBus: makeMockTypedEventBus(),
      agentQuery: makeAgentQuery(),
      streamDir: STREAM_DIR,
      setup,
    });

    const viewer = harness.openOverlay();
    expect(setup).toHaveBeenCalledWith(viewer);
    expect(connect).toHaveBeenCalledWith(viewer, STREAM_DIR);

    harness.dismissOverlay();
    (await promise).dispose();
  });

  it("releases wiring when ui.custom resolves without opening an overlay", async () => {
    const { unsub } = mockWiring();
    const harness = makeHarness();

    const promise = showAgentViewer({
      ctx: harness.ctx,
      config,
      toolRegistry: makeMockToolRegistry(),
      eventBus: makeMockTypedEventBus(),
      agentQuery: makeAgentQuery(),
      streamDir: STREAM_DIR,
    });

    harness.resolveWithoutOpening();
    const handle = await promise;

    expect(handle.viewer).toBeUndefined();
    expect(unsub).toHaveBeenCalledTimes(1);
    handle.dispose();
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it("disposes the constructed viewer when setup throws", async () => {
    const harness = makeHarness();
    let capturedViewer: AgentViewerOverlay | undefined;

    const promise = showAgentViewer({
      ctx: harness.ctx,
      config,
      toolRegistry: makeMockToolRegistry(),
      streamDir: STREAM_DIR,
      setup: (viewer) => {
        capturedViewer = viewer;
        throw new Error("setup boom");
      },
    });

    // Simulate pi: a throw inside the custom factory rejects ui.custom.
    let thrown: unknown;
    try {
      harness.openOverlay();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    const disposeSpy = vi.spyOn(capturedViewer as AgentViewerOverlay, "dispose");
    harness.rejectCustom(thrown);

    await expect(promise).rejects.toThrow("setup boom");
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it("defaults the stream dir to the session-shared stream directory", async () => {
    const { connect } = mockWiring();
    const harness = makeHarness();

    const promise = showAgentViewer({
      ctx: harness.ctx,
      config,
      toolRegistry: makeMockToolRegistry(),
      eventBus: makeMockTypedEventBus(),
      agentQuery: makeAgentQuery(),
    });

    const viewer = harness.openOverlay();
    expect(connect).toHaveBeenCalledWith(viewer, SharedStreamDir.get(config.getLogDir()));

    harness.dismissOverlay();
    (await promise).dispose();
  });

  it("dispose tears down subscriptions, disposes the viewer, dismisses, and calls onDismiss once", async () => {
    const { unsub } = mockWiring();
    const onDismiss = vi.fn();
    const harness = makeHarness();

    const promise = showAgentViewer({
      ctx: harness.ctx,
      config,
      toolRegistry: makeMockToolRegistry(),
      eventBus: makeMockTypedEventBus(),
      agentQuery: makeAgentQuery(),
      streamDir: STREAM_DIR,
      onDismiss,
    });

    const viewer = harness.openOverlay();
    const disposeSpy = vi.spyOn(viewer as AgentViewerOverlay, "dispose");

    // Esc in list view — the realistic dismiss path: onDone → dispose.
    (viewer as AgentViewerOverlay).handleInput("\x1b");
    const handle = await promise;

    expect(unsub).toHaveBeenCalledTimes(1);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    handle.dispose();
    expect(unsub).toHaveBeenCalledTimes(1);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("rejects when overlay creation fails", async () => {
    const harness = makeHarness();
    harness.custom.mockRejectedValue(new Error("boom"));

    await expect(
      showAgentViewer({
        ctx: harness.ctx,
        config,
        toolRegistry: makeMockToolRegistry(),
        streamDir: STREAM_DIR,
      }),
    ).rejects.toThrow("boom");
  });

  // ── Singleton reuse semantics ───────────────────────────────

  it("reuses an open overlay on a second invocation — single custom call, same viewer, refocused", async () => {
    const harness = makeHarness();
    const first = showAgentViewer({
      ctx: harness.ctx,
      config,
      toolRegistry: makeMockToolRegistry(),
      streamDir: STREAM_DIR,
    });
    const viewer = harness.openOverlay();
    const handle = harness.attachOverlayHandle();

    const reuse = await showAgentViewer({
      ctx: harness.ctx,
      config,
      toolRegistry: makeMockToolRegistry(),
      streamDir: STREAM_DIR,
    });

    expect(harness.custom).toHaveBeenCalledTimes(1);
    expect(reuse.viewer).toBe(viewer);
    expect(handle.focus).toHaveBeenCalledTimes(1);

    harness.dismissOverlay();
    (await first).dispose();
  });

  it("reusing callers get a no-op dispose — the opener retains lifecycle ownership", async () => {
    const { unsub } = mockWiring();
    const onDismiss = vi.fn();
    const harness = makeHarness();

    const first = showAgentViewer({
      ctx: harness.ctx,
      config,
      toolRegistry: makeMockToolRegistry(),
      eventBus: makeMockTypedEventBus(),
      agentQuery: makeAgentQuery(),
      streamDir: STREAM_DIR,
      onDismiss,
    });
    const viewer = harness.openOverlay();
    const viewerDisposeSpy = vi.spyOn(viewer as AgentViewerOverlay, "dispose");
    harness.attachOverlayHandle();

    const reuse = await showAgentViewer({
      ctx: harness.ctx,
      config,
      toolRegistry: makeMockToolRegistry(),
      eventBus: makeMockTypedEventBus(),
      agentQuery: makeAgentQuery(),
      streamDir: STREAM_DIR,
    });

    // Reuse ignores the caller's wiring — still exactly one connection.
    expect(AgentViewerOverlay.wireOverlayEvents).toHaveBeenCalledTimes(1);
    reuse.dispose();
    expect(viewerDisposeSpy).not.toHaveBeenCalled();
    expect(unsub).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();

    harness.dismissOverlay();
    (await first).dispose();
    expect(viewerDisposeSpy).toHaveBeenCalledTimes(1);
    expect(unsub).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("opens a fresh instance after dismissal — the next invocation refocuses the new overlay", async () => {
    const harness = makeHarness();

    const first = showAgentViewer({
      ctx: harness.ctx,
      config,
      toolRegistry: makeMockToolRegistry(),
      streamDir: STREAM_DIR,
    });
    const viewer1 = harness.openOverlay();
    const handle1 = harness.attachOverlayHandle();
    const reuse1 = await showAgentViewer({
      ctx: harness.ctx,
      config,
      toolRegistry: makeMockToolRegistry(),
      streamDir: STREAM_DIR,
    });
    expect(reuse1.viewer).toBe(viewer1);

    harness.dismissOverlay();
    (await first).dispose();

    const second = showAgentViewer({
      ctx: harness.ctx,
      config,
      toolRegistry: makeMockToolRegistry(),
      streamDir: STREAM_DIR,
    });
    const viewer2 = harness.openOverlay();
    const handle2 = harness.attachOverlayHandle();
    expect(harness.custom).toHaveBeenCalledTimes(2);
    expect(viewer2).toBeInstanceOf(AgentViewerOverlay);
    expect(viewer2).not.toBe(viewer1);

    const reuse2 = await showAgentViewer({
      ctx: harness.ctx,
      config,
      toolRegistry: makeMockToolRegistry(),
      streamDir: STREAM_DIR,
    });
    expect(reuse2.viewer).toBe(viewer2);
    expect(handle2.focus).toHaveBeenCalledTimes(1);
    expect(handle1.focus).toHaveBeenCalledTimes(1);

    harness.dismissOverlay();
    (await second).dispose();
  });

  it("reuses while the overlay is still opening — claim before the custom promise settles", async () => {
    const harness = makeHarness();
    const first = showAgentViewer({
      ctx: harness.ctx,
      config,
      toolRegistry: makeMockToolRegistry(),
      streamDir: STREAM_DIR,
    });

    // Second invocation before the factory ran: no second overlay, and the
    // pending viewer is handed back with a no-op dispose (RoutineTool's
    // finally disposes unconditionally — that must be safe).
    const reuse = await showAgentViewer({
      ctx: harness.ctx,
      config,
      toolRegistry: makeMockToolRegistry(),
      streamDir: STREAM_DIR,
    });
    expect(harness.custom).toHaveBeenCalledTimes(1);
    expect(reuse.viewer).toBeUndefined();
    reuse.dispose();

    const viewer = harness.openOverlay();
    expect(viewer).toBeInstanceOf(AgentViewerOverlay);
    harness.dismissOverlay();
    (await first).dispose();
  });

  it("releases the singleton when overlay creation fails — a later invocation opens fresh", async () => {
    const harness = makeHarness();
    harness.custom.mockRejectedValueOnce(new Error("boom"));

    await expect(
      showAgentViewer({
        ctx: harness.ctx,
        config,
        toolRegistry: makeMockToolRegistry(),
        streamDir: STREAM_DIR,
      }),
    ).rejects.toThrow("boom");

    const promise = showAgentViewer({
      ctx: harness.ctx,
      config,
      toolRegistry: makeMockToolRegistry(),
      streamDir: STREAM_DIR,
    });
    const viewer = harness.openOverlay();
    expect(harness.custom).toHaveBeenCalledTimes(2);
    expect(viewer).toBeInstanceOf(AgentViewerOverlay);

    harness.dismissOverlay();
    (await promise).dispose();
  });

  it("releases the singleton when ui.custom resolves without opening (headless) — the next call opens a real overlay", async () => {
    const harness = makeHarness();

    const firstPromise = showAgentViewer({
      ctx: harness.ctx,
      config,
      toolRegistry: makeMockToolRegistry(),
      streamDir: STREAM_DIR,
    });
    harness.resolveWithoutOpening();
    const first = await firstPromise;
    expect(first.viewer).toBeUndefined();

    const promise = showAgentViewer({
      ctx: harness.ctx,
      config,
      toolRegistry: makeMockToolRegistry(),
      streamDir: STREAM_DIR,
    });
    const viewer = harness.openOverlay();
    expect(harness.custom).toHaveBeenCalledTimes(2);
    expect(viewer).toBeInstanceOf(AgentViewerOverlay);

    harness.dismissOverlay();
    (await promise).dispose();
  });
});
