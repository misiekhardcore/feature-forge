// Spy on logger methods so we can assert log output without mocking the module.
import { logger } from "@feature-forge/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MockWorkspaceProvider, MockWorktreeRegistry } from "../test-utils";
import { cleanupWorkspaces, registerSignalHandlers } from "./registerSignalHandlers";
import { WorkspaceHandle } from "./WorkspaceHandle";
import { WorkspaceManager } from "./WorkspaceManager";

describe("registerSignalHandlers", () => {
  let workspaceManager: WorkspaceManager;
  let provider: MockWorkspaceProvider;
  let registry: MockWorktreeRegistry;
  let onceCalls: Array<[string, (...args: unknown[]) => unknown]>;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new MockWorkspaceProvider();
    registry = new MockWorktreeRegistry();
    workspaceManager = new WorkspaceManager(provider, registry);

    onceCalls = [];

    vi.spyOn(process, "once").mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (signal: string | symbol, handler: (...args: any[]) => void) => {
        onceCalls.push([String(signal), handler]);
        return process;
      },
    );
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  it("registers a once handler for SIGINT", () => {
    registerSignalHandlers(workspaceManager);
    const sigint = onceCalls.find(([s]) => s === "SIGINT");
    expect(sigint).toBeDefined();
    expect(typeof sigint![1]).toBe("function");
  });

  it("registers a once handler for SIGTERM", () => {
    registerSignalHandlers(workspaceManager);
    const sigterm = onceCalls.find(([s]) => s === "SIGTERM");
    expect(sigterm).toBeDefined();
    expect(typeof sigterm![1]).toBe("function");
  });

  it("uses process.once so handler auto-removes after firing", () => {
    registerSignalHandlers(workspaceManager);
    expect(process.once).toHaveBeenCalledTimes(2);
    expect(process.once).toHaveBeenCalledWith("SIGINT", expect.any(Function));
    expect(process.once).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
  });
});

describe("cleanupWorkspaces", () => {
  let workspaceManager: WorkspaceManager;
  let provider: MockWorkspaceProvider;
  let registry: MockWorktreeRegistry;

  beforeEach(async () => {
    vi.clearAllMocks();
    provider = new MockWorkspaceProvider();
    registry = new MockWorktreeRegistry();
    workspaceManager = new WorkspaceManager(provider, registry);

    vi.spyOn(logger, "info");
    vi.spyOn(logger, "warn");
    vi.spyOn(logger, "error");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createHandle(path: string): WorkspaceHandle {
    return new WorkspaceHandle(path, new Date());
  }

  describe("no workspaces", () => {
    it("logs info and exits 0 on SIGINT", () => {
      const exit = vi.fn();

      cleanupWorkspaces(workspaceManager, "SIGINT", [], exit);

      expect(logger.info).toHaveBeenCalledWith(
        "[feature-forge] Received SIGINT, no active workspaces to clean up",
      );
      expect(exit).toHaveBeenCalledWith(0);
    });

    it("logs info and exits 0 on SIGTERM", () => {
      const exit = vi.fn();

      cleanupWorkspaces(workspaceManager, "SIGTERM", [], exit);

      expect(logger.info).toHaveBeenCalledWith(
        "[feature-forge] Received SIGTERM, no active workspaces to clean up",
      );
      expect(exit).toHaveBeenCalledWith(0);
    });
  });

  describe("with active workspaces", () => {
    it("destroys all workspaces and exits 0 on success", async () => {
      const exit = vi.fn();
      const h1 = createHandle("/tmp/ws-1");
      const h2 = createHandle("/tmp/ws-2");

      // Register handles so destroy can look them up
      await registry.register(h1);
      await registry.register(h2);

      cleanupWorkspaces(workspaceManager, "SIGINT", [h1, h2], exit);

      // Fast-forward past the destruction (all sync in mock)
      await vi.runAllTimersAsync();

      expect(logger.info).toHaveBeenCalledWith(
        "[feature-forge] Received SIGINT, cleaning up 2 workspace(s)",
      );
      expect(logger.info).toHaveBeenCalledWith(
        "[feature-forge] Cleaned up 2 workspace(s) on SIGINT",
      );
      expect(exit).toHaveBeenCalledWith(0);
    });

    it("exits 1 when a destroy fails", async () => {
      const exit = vi.fn();
      const h1 = createHandle("/tmp/ws-ok");
      // h2 path intentionally not registered — destroy will throw
      const h2 = createHandle("/tmp/ws-fail");

      await registry.register(h1);
      // h2 is NOT registered, so destroy will fail with "No workspace found"

      cleanupWorkspaces(workspaceManager, "SIGTERM", [h1, h2], exit);
      await vi.runAllTimersAsync();

      expect(logger.warn).toHaveBeenCalled();
      expect(exit).toHaveBeenCalledWith(1);
    });

    it("exits 1 on timeout", async () => {
      const exit = vi.fn();
      const h1 = createHandle("/tmp/ws-slow");

      // Make destroy hang by never resolving the provider
      provider.shouldFailDestruction = true;
      provider.failureMessage = "hang";
      // Override destroyWorkspace to return a never-resolving promise
      const neverResolve = new Promise<void>(() => {});
      vi.spyOn(provider, "destroyWorkspace").mockReturnValue(neverResolve);

      await registry.register(h1);

      cleanupWorkspaces(workspaceManager, "SIGINT", [h1], exit);

      // Fast-forward past the 2s timeout
      vi.advanceTimersByTime(2500);
      await vi.runAllTimersAsync();

      expect(logger.warn).toHaveBeenCalledWith(
        "[feature-forge] Workspace cleanup timed out on SIGINT, forcing exit",
      );
      expect(exit).toHaveBeenCalledWith(1);
    });

    it("does not throw when exit is the real process.exit (default param)", () => {
      const h1 = createHandle("/tmp/ws-1");

      // Should not throw even with the real process.exit reference
      expect(() => {
        cleanupWorkspaces(workspaceManager, "SIGINT", [h1]);
      }).not.toThrow();
    });

    it("handles concurrent destroy calls independently", async () => {
      const exit = vi.fn();
      const h1 = createHandle("/tmp/ws-1");
      const h2 = createHandle("/tmp/ws-2");
      const h3 = createHandle("/tmp/ws-3");

      await registry.register(h1);
      // h2 and h3 not registered — they will fail

      cleanupWorkspaces(workspaceManager, "SIGINT", [h1, h2, h3], exit);
      await vi.runAllTimersAsync();

      // One success, two failures → exit 1
      expect(exit).toHaveBeenCalledWith(1);
    });
  });

  describe("error in .then() callback", () => {
    it("catches synchronous throws in the then callback", async () => {
      // First call throws (in .then()), second call (in .catch()) succeeds
      let callCount = 0;
      const exit = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error("exit threw");
        }
      });
      const h1 = createHandle("/tmp/ws-1");
      await registry.register(h1);

      // Should not throw — caught by .catch()
      expect(() => {
        cleanupWorkspaces(workspaceManager, "SIGINT", [h1], exit);
      }).not.toThrow();

      await vi.runAllTimersAsync();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Unexpected error during SIGINT cleanup"),
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });
  });
});
