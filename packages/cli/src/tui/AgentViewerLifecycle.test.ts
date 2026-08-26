import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ForgeConfig, logger } from "@feature-forge/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { showAgentViewerMock } = vi.hoisted(() => {
  type ShowAgentViewer = (
    params: import("./showAgentViewer").ShowAgentViewerParams,
  ) => Promise<import("./showAgentViewer").AgentViewerHandle>;
  return { showAgentViewerMock: vi.fn<ShowAgentViewer>() };
});

vi.mock("./showAgentViewer", () => ({ showAgentViewer: showAgentViewerMock }));

import { makeMockToolRegistry, makeMockTypedEventBus } from "../test-utils";
import { AgentViewerLifecycle } from "./AgentViewerLifecycle";
import type { AgentQuery } from "./api";
import type { AgentViewerHandle } from "./showAgentViewer";

// ── Helpers ──────────────────────────────────────────────────

function makeHarness(overrides: { hasUI?: boolean } = {}): {
  ctx: ExtensionContext;
  toolRegistry: ReturnType<typeof makeMockToolRegistry>;
  eventBus: ReturnType<typeof makeMockTypedEventBus>;
  agentQuery: AgentQuery;
  viewer: AgentViewerLifecycle;
} {
  const ctx = { hasUI: overrides.hasUI ?? true } as ExtensionContext;
  const toolRegistry = makeMockToolRegistry();
  const eventBus = makeMockTypedEventBus();
  const agentQuery = { getAgent: vi.fn(), getAllAgents: vi.fn() } as unknown as AgentQuery;
  const viewer = new AgentViewerLifecycle({ ctx, toolRegistry, eventBus, agentQuery });
  return { ctx, toolRegistry, eventBus, agentQuery, viewer };
}

// ── Tests ────────────────────────────────────────────────────

describe("AgentViewerLifecycle", () => {
  beforeEach(() => {
    showAgentViewerMock.mockReset();
    showAgentViewerMock.mockResolvedValue({ viewer: undefined, dispose: vi.fn() });
  });

  describe("open", () => {
    it("opens the viewer with ctx, config, toolRegistry, eventBus and agentQuery", () => {
      const { ctx, toolRegistry, eventBus, agentQuery, viewer } = makeHarness();

      viewer.open();

      expect(showAgentViewerMock).toHaveBeenCalledWith({
        ctx,
        config: ForgeConfig.getInstance(),
        toolRegistry,
        eventBus,
        agentQuery,
      });
    });

    it("is one-shot: repeated open calls open the viewer only once", () => {
      const { viewer } = makeHarness();

      viewer.open();
      viewer.open();
      viewer.open();

      expect(showAgentViewerMock).toHaveBeenCalledTimes(1);
    });

    it("does nothing when the context has no UI surface", () => {
      const { viewer } = makeHarness({ hasUI: false });

      viewer.open();

      expect(showAgentViewerMock).not.toHaveBeenCalled();
    });
  });

  describe("dispose", () => {
    it("disposes the resolved handle exactly once", async () => {
      const dispose = vi.fn();
      showAgentViewerMock.mockResolvedValue({ viewer: undefined, dispose });
      const { viewer } = makeHarness();

      viewer.open();
      // Flush the handle-resolution microtask so the handle is captured.
      await Promise.resolve();
      await Promise.resolve();

      viewer.dispose();

      expect(dispose).toHaveBeenCalledTimes(1);
    });

    it("does not throw when disposed before the handle resolves", () => {
      showAgentViewerMock.mockReturnValue(new Promise<AgentViewerHandle>(() => {}));
      const { viewer } = makeHarness();

      viewer.open();

      expect(() => viewer.dispose()).not.toThrow();
    });

    it("is idempotent: disposing twice disposes the handle once", async () => {
      const dispose = vi.fn();
      showAgentViewerMock.mockResolvedValue({ viewer: undefined, dispose });
      const { viewer } = makeHarness();

      viewer.open();
      await Promise.resolve();
      await Promise.resolve();

      viewer.dispose();
      viewer.dispose();

      expect(dispose).toHaveBeenCalledTimes(1);
    });

    it("does not auto-dispose a handle that resolves after dispose — teardown belongs to the composer", async () => {
      const dispose = vi.fn();
      let resolve!: (handle: AgentViewerHandle) => void;
      showAgentViewerMock.mockReturnValue(
        new Promise<AgentViewerHandle>((res) => {
          resolve = res;
        }),
      );
      const { viewer } = makeHarness();

      viewer.open();
      viewer.dispose(); // no-op: the handle is not captured yet
      expect(() => resolve({ viewer: undefined, dispose })).not.toThrow();
      await Promise.resolve();
      await Promise.resolve();

      // The lifecycle never auto-disposes the captured handle. Retention is
      // intentional: the handle stays available so the composer's own
      // teardown can still release it later.
      expect(dispose).not.toHaveBeenCalled();
      viewer.dispose();
      expect(dispose).toHaveBeenCalledTimes(1);
    });
  });

  describe("open failures", () => {
    it("logs and swallows showAgentViewer rejections", async () => {
      showAgentViewerMock.mockRejectedValue(new Error("boom"));
      const { viewer } = makeHarness();
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      try {
        expect(() => viewer.open()).not.toThrow();

        await vi.waitFor(() =>
          expect(warnSpy).toHaveBeenCalledWith("Agent viewer overlay creation failed", {
            err: expect.any(Error),
          }),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("does not retry after a rejection — the one-shot flag is set before the async call", async () => {
      showAgentViewerMock.mockRejectedValueOnce(new Error("boom"));
      const { viewer } = makeHarness();
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      try {
        viewer.open();
        // Wait until the rejection has been processed: showAgentViewer
        // releases its singleton on creation errors, so without the one-shot
        // flag a later open() would re-invoke it.
        await vi.waitFor(() =>
          expect(warnSpy).toHaveBeenCalledWith("Agent viewer overlay creation failed", {
            err: expect.any(Error),
          }),
        );
        viewer.open();
        await Promise.resolve();

        expect(showAgentViewerMock).toHaveBeenCalledTimes(1);
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
