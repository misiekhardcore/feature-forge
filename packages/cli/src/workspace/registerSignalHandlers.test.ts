import { logger } from "@feature-forge/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MockWorkspaceProvider, MockWorktreeRegistry } from "../test-utils";
import { cleanupWorkspaces, registerSignalHandlers } from "./registerSignalHandlers";
import {
  addSessionWorkspace,
  clearSessionWorkspaces,
  getSessionWorkspacePaths,
} from "./sessionWorkspaces";
import { WorkspaceHandle } from "./WorkspaceHandle";
import { WorkspaceManager } from "./WorkspaceManager";

describe("registerSignalHandlers", () => {
  let workspaceManager: WorkspaceManager;
  let provider: MockWorkspaceProvider;
  let registry: MockWorktreeRegistry;
  let onCalls: Array<[string, (...args: unknown[]) => unknown]>;
  let removeListenerCalls: Array<[string, (...args: unknown[]) => unknown]>;

  beforeEach(() => {
    vi.clearAllMocks();
    clearSessionWorkspaces();
    provider = new MockWorkspaceProvider();
    registry = new MockWorktreeRegistry();
    workspaceManager = new WorkspaceManager(provider, registry);

    onCalls = [];
    removeListenerCalls = [];

    vi.spyOn(process, "on").mockImplementation(
      (signal: string | symbol, handler: (...args: unknown[]) => void) => {
        onCalls.push([String(signal), handler]);
        return process;
      },
    );
    vi.spyOn(process, "removeListener").mockImplementation(
      (signal: string | symbol, handler: (...args: unknown[]) => void) => {
        removeListenerCalls.push([String(signal), handler]);
        return process;
      },
    );
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    clearSessionWorkspaces();
  });

  it("registers a handler for SIGINT using process.on", () => {
    registerSignalHandlers(workspaceManager, () => []);
    const sigint = onCalls.find(([s]) => s === "SIGINT");
    expect(sigint).toBeDefined();
    expect(typeof sigint![1]).toBe("function");
  });

  it("registers a handler for SIGTERM using process.on", () => {
    registerSignalHandlers(workspaceManager, () => []);
    const sigterm = onCalls.find(([s]) => s === "SIGTERM");
    expect(sigterm).toBeDefined();
    expect(typeof sigterm![1]).toBe("function");
  });

  it("uses process.on (not process.once) for both signals", () => {
    registerSignalHandlers(workspaceManager, () => []);
    expect(process.on).toHaveBeenCalledTimes(2);
    expect(process.on).toHaveBeenCalledWith("SIGINT", expect.any(Function));
    expect(process.on).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
  });

  it("removes listeners and clears session workspaces after cleanup completes", async () => {
    vi.useFakeTimers();
    const h1 = new WorkspaceHandle("/tmp/ws-1", new Date());
    await registry.register(h1);
    addSessionWorkspace("/tmp/ws-1");

    registerSignalHandlers(workspaceManager, getSessionWorkspacePaths);

    const sigintHandler = onCalls.find(([s]) => s === "SIGINT")![1];
    sigintHandler();

    await vi.runAllTimersAsync();

    const sigintRemoved = removeListenerCalls.find(([s]) => s === "SIGINT");
    const sigtermRemoved = removeListenerCalls.find(([s]) => s === "SIGTERM");
    expect(sigintRemoved).toBeDefined();
    expect(sigtermRemoved).toBeDefined();
    expect(getSessionWorkspacePaths()).toEqual([]);

    vi.useRealTimers();
  });

  it("only destroys session-scoped paths, not all registry workspaces", async () => {
    vi.useFakeTimers();
    const exit = vi.fn();

    const hA = new WorkspaceHandle("/tmp/ws-A", new Date());
    const hB = new WorkspaceHandle("/tmp/ws-B", new Date());
    const hC = new WorkspaceHandle("/tmp/ws-C", new Date());
    await registry.register(hA);
    await registry.register(hB);
    await registry.register(hC);

    addSessionWorkspace("/tmp/ws-A");
    addSessionWorkspace("/tmp/ws-B");

    const destroySpy = vi.spyOn(provider, "destroyWorkspace");

    cleanupWorkspaces(workspaceManager, "SIGINT", getSessionWorkspacePaths(), exit);
    await vi.runAllTimersAsync();

    expect(destroySpy).toHaveBeenCalledTimes(2);
    expect(destroySpy).toHaveBeenCalledWith("/tmp/ws-A", undefined);
    expect(destroySpy).toHaveBeenCalledWith("/tmp/ws-B", undefined);
    expect(destroySpy).not.toHaveBeenCalledWith("/tmp/ws-C", undefined);

    vi.useRealTimers();
  });

  it("second registration after cleanup works (extension reload scenario)", () => {
    registerSignalHandlers(workspaceManager, () => []);
    expect(process.on).toHaveBeenCalledTimes(2);

    vi.clearAllMocks();
    vi.spyOn(process, "on").mockImplementation(
      (signal: string | symbol, handler: (...args: unknown[]) => void) => {
        onCalls.push([String(signal), handler]);
        return process;
      },
    );

    registerSignalHandlers(workspaceManager, () => []);
    expect(process.on).toHaveBeenCalledTimes(2);
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

  describe("no session workspaces", () => {
    it("logs info and exits 0 on SIGINT", () => {
      const exit = vi.fn();

      cleanupWorkspaces(workspaceManager, "SIGINT", [], exit);

      expect(logger.info).toHaveBeenCalledWith(
        "[feature-forge] Received SIGINT, no session workspaces to clean up",
      );
      expect(exit).toHaveBeenCalledWith(0);
    });

    it("logs info and exits 0 on SIGTERM", () => {
      const exit = vi.fn();

      cleanupWorkspaces(workspaceManager, "SIGTERM", [], exit);

      expect(logger.info).toHaveBeenCalledWith(
        "[feature-forge] Received SIGTERM, no session workspaces to clean up",
      );
      expect(exit).toHaveBeenCalledWith(0);
    });
  });

  describe("with session workspaces", () => {
    it("destroys all session workspaces and exits 0 on success", async () => {
      const exit = vi.fn();
      const h1 = createHandle("/tmp/ws-1");
      const h2 = createHandle("/tmp/ws-2");

      await registry.register(h1);
      await registry.register(h2);

      cleanupWorkspaces(workspaceManager, "SIGINT", ["/tmp/ws-1", "/tmp/ws-2"], exit);

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

      await registry.register(h1);

      cleanupWorkspaces(workspaceManager, "SIGTERM", ["/tmp/ws-ok", "/tmp/ws-fail"], exit);
      await vi.runAllTimersAsync();

      expect(logger.warn).toHaveBeenCalled();
      expect(exit).toHaveBeenCalledWith(1);
    });

    it("exits 1 on timeout", async () => {
      const exit = vi.fn();
      const h1 = createHandle("/tmp/ws-slow");

      provider.shouldFailDestruction = true;
      provider.failureMessage = "hang";
      const neverResolve = new Promise<void>(() => {});
      vi.spyOn(provider, "destroyWorkspace").mockReturnValue(neverResolve);

      await registry.register(h1);

      cleanupWorkspaces(workspaceManager, "SIGINT", ["/tmp/ws-slow"], exit);

      vi.advanceTimersByTime(2500);
      await vi.runAllTimersAsync();

      expect(logger.warn).toHaveBeenCalledWith(
        "[feature-forge] Workspace cleanup timed out on SIGINT, forcing exit",
      );
      expect(exit).toHaveBeenCalledWith(1);
    });

    it("does not throw when exit is the real process.exit (default param)", () => {
      expect(() => {
        cleanupWorkspaces(workspaceManager, "SIGINT", ["/tmp/ws-1"]);
      }).not.toThrow();
    });

    it("handles concurrent destroy calls independently", async () => {
      const exit = vi.fn();
      const h1 = createHandle("/tmp/ws-1");

      await registry.register(h1);

      cleanupWorkspaces(workspaceManager, "SIGINT", ["/tmp/ws-1", "/tmp/ws-2", "/tmp/ws-3"], exit);
      await vi.runAllTimersAsync();

      expect(exit).toHaveBeenCalledWith(1);
    });
  });

  describe("error in .then() callback", () => {
    it("catches synchronous throws in the then callback", async () => {
      let callCount = 0;
      const exit = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error("exit threw");
        }
      });
      const h1 = createHandle("/tmp/ws-1");
      await registry.register(h1);

      expect(() => {
        cleanupWorkspaces(workspaceManager, "SIGINT", ["/tmp/ws-1"], exit);
      }).not.toThrow();

      await vi.runAllTimersAsync();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Unexpected error during SIGINT cleanup"),
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });
  });

  describe("session scoping", () => {
    it("only destroys paths passed, not all registry entries", async () => {
      const exit = vi.fn();
      const hA = createHandle("/tmp/ws-session");
      const hB = createHandle("/tmp/ws-other");

      await registry.register(hA);
      await registry.register(hB);

      const destroySpy = vi.spyOn(provider, "destroyWorkspace");

      cleanupWorkspaces(workspaceManager, "SIGINT", ["/tmp/ws-session"], exit);
      await vi.runAllTimersAsync();

      expect(destroySpy).toHaveBeenCalledTimes(1);
      expect(destroySpy).toHaveBeenCalledWith("/tmp/ws-session", undefined);
      expect(destroySpy).not.toHaveBeenCalledWith("/tmp/ws-other", undefined);
    });
  });
});
