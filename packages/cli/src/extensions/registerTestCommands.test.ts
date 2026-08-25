import * as path from "node:path";

import { ForgeConfig } from "@feature-forge/core";
import { withForgePrefix } from "@feature-forge/core/registry";
import { ToolRegistry } from "@feature-forge/core/registry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeMockCtx, makeMockPi } from "../test-utils";
import { showAgentViewer } from "../tui/showAgentViewer";
import type { AgentViewerOverlay } from "../tui/views/AgentViewerOverlay";
import { registerDevTestCommands } from "./registerTestCommands";

vi.mock("../tui/showAgentViewer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tui/showAgentViewer")>();
  return { ...actual, showAgentViewer: vi.fn() };
});

const showAgentViewerMock = vi.mocked(showAgentViewer);

function registerCommands() {
  const pi = makeMockPi();
  registerDevTestCommands(pi, new ToolRegistry(null, pi));
  return pi;
}

function getHandler(pi: ReturnType<typeof makeMockPi>, name: string) {
  const call = vi.mocked(pi.registerCommand).mock.calls.find(([cmdName]) => cmdName === name);
  expect(call, `command ${name} registered`).toBeDefined();
  return call![1].handler;
}

function makeViewer(): {
  update: ReturnType<typeof vi.fn>;
  pushStreamEvent: ReturnType<typeof vi.fn>;
  setStreamDir: ReturnType<typeof vi.fn>;
} {
  return {
    update: vi.fn(),
    pushStreamEvent: vi.fn(),
    setStreamDir: vi.fn(),
  };
}

describe("registerDevTestCommands", () => {
  let devEnabledSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    devEnabledSpy = vi.spyOn(ForgeConfig, "getInstance").mockReturnValue({
      getDevEnabled: () => true,
    } as unknown as ForgeConfig);
    showAgentViewerMock.mockReset();
    showAgentViewerMock.mockResolvedValue({ viewer: undefined, dispose: vi.fn() });
  });

  afterEach(() => {
    devEnabledSpy.mockRestore();
  });

  it("registers the four viewer test commands plus the debug loop routine", () => {
    const pi = registerCommands();

    const names = vi.mocked(pi.registerCommand).mock.calls.map(([name]) => name);
    expect(names).toEqual(
      expect.arrayContaining([
        withForgePrefix("test-viewer"),
        withForgePrefix("test-scroll"),
        withForgePrefix("test-tool-args"),
        withForgePrefix("test-stream-replay"),
        "test-loop-routine",
      ]),
    );
  });

  it("registers nothing when dev mode is disabled", () => {
    devEnabledSpy.mockReturnValue({ getDevEnabled: () => false });
    const pi = registerCommands();

    expect(pi.registerCommand).not.toHaveBeenCalled();
  });

  it("delegates to showAgentViewer with setup scheduling scenarios and onDismiss clearing timers", async () => {
    vi.useFakeTimers();
    try {
      const pi = registerCommands();
      const handler = getHandler(pi, withForgePrefix("test-scroll"));
      const viewer = makeViewer() as unknown as AgentViewerOverlay;

      await handler("", makeMockCtx());

      expect(showAgentViewerMock).toHaveBeenCalledTimes(1);
      const params = showAgentViewerMock.mock.calls[0][0];
      expect(params.ctx).toBeDefined();
      expect(params.config).toBeDefined();
      expect(params.toolRegistry).toBeDefined();
      expect(params.setup).toBeTypeOf("function");
      expect(params.onDismiss).toBeTypeOf("function");

      params.setup!(viewer);
      expect(viewer.update).toHaveBeenCalledWith(expect.objectContaining({ status: "started" }));
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      params.onDismiss!();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("schedules all seven scenarios for test-viewer", async () => {
    const pi = registerCommands();
    const handler = getHandler(pi, withForgePrefix("test-viewer"));
    const viewer = makeViewer() as unknown as AgentViewerOverlay;

    await handler("", makeMockCtx());

    const params = showAgentViewerMock.mock.calls[0][0];
    params.setup!(viewer);
    expect(viewer.update).toHaveBeenCalledTimes(7);
  });

  it("sets the stream directory under .pi/test-streams and a zero event delay for test-stream-replay", async () => {
    vi.useFakeTimers();
    try {
      const pi = registerCommands();
      const handler = getHandler(pi, withForgePrefix("test-stream-replay"));
      const viewer = makeViewer() as unknown as AgentViewerOverlay;

      await handler("", { ...makeMockCtx(), cwd: "/proj" });

      const params = showAgentViewerMock.mock.calls[0][0];
      params.setup!(viewer);
      expect(viewer.setStreamDir).toHaveBeenCalledWith(path.join("/proj", ".pi", "test-streams"));
      expect(viewer.pushStreamEvent).not.toHaveBeenCalled();

      // eventDelay: 0 — every scheduled event fires immediately
      vi.advanceTimersByTime(0);
      expect(viewer.pushStreamEvent).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing without UI", async () => {
    const pi = registerCommands();
    const handler = getHandler(pi, withForgePrefix("test-viewer"));

    await handler("", { ...makeMockCtx(), hasUI: false });

    expect(showAgentViewerMock).not.toHaveBeenCalled();
  });

  it.each(["test-scroll", "test-tool-args", "test-stream-replay"])(
    "does nothing without UI for %s",
    async (command) => {
      const pi = registerCommands();
      const handler = getHandler(pi, withForgePrefix(command));

      await handler("", { ...makeMockCtx(), hasUI: false });

      expect(showAgentViewerMock).not.toHaveBeenCalled();
    },
  );
});
