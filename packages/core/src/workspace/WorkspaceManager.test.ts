import { MockWorkspaceProvider, MockWorktreeRegistry } from "@feature-forge/core/test-utils";
import { beforeEach, describe, expect, it } from "vitest";

import { WorkspaceHandle } from "./WorkspaceHandle";
import { WorkspaceManager } from "./WorkspaceManager";

describe("WorkspaceManager", () => {
  let provider: MockWorkspaceProvider;
  let registry: MockWorktreeRegistry;
  let manager: WorkspaceManager;

  beforeEach(() => {
    provider = new MockWorkspaceProvider();
    registry = new MockWorktreeRegistry();
    manager = new WorkspaceManager(provider, registry);
  });

  describe("create", () => {
    it("creates a workspace via provider and registers a handle", async () => {
      const handle = await manager.create("task-1");

      expect(handle).toBeInstanceOf(WorkspaceHandle);
      expect(handle.path).toBe("/tmp/mock-workspaces/task-1");
      expect(handle.createdAt).toBeInstanceOf(Date);
      expect(registry.get("/tmp/mock-workspaces/task-1")).toBeDefined();
    });

    it("creates different paths for different workspace ids", async () => {
      const handleA = await manager.create("task-a");
      const handleB = await manager.create("task-b");

      expect(handleA.path).not.toBe(handleB.path);
      expect(handleA.path).toBe("/tmp/mock-workspaces/task-a");
      expect(handleB.path).toBe("/tmp/mock-workspaces/task-b");
    });

    it("propagates provider errors without registering", async () => {
      provider.shouldFailCreation = true;
      provider.failureMessage = "disk is full";

      await expect(manager.create("task-1")).rejects.toThrow("disk is full");
      expect(registry.get("/tmp/mock-workspaces/task-1")).toBeUndefined();
    });
  });

  describe("destroy", () => {
    it("removes a previously created workspace from the registry", async () => {
      const handle = await manager.create("task-1");
      expect(registry.get(handle.path)).toBeDefined();

      await manager.destroy(handle.path);

      expect(registry.get(handle.path)).toBeUndefined();
    });

    it("throws for an unknown workspace path", async () => {
      await expect(manager.destroy("/nonexistent")).rejects.toThrow(
        'No workspace found at path "/nonexistent"',
      );
    });
  });

  describe("get", () => {
    it("returns a handle for a registered workspace by path", async () => {
      const handle = await manager.create("task-1");
      const found = manager.get(handle.path);

      expect(found).toBeInstanceOf(WorkspaceHandle);
      expect(found!.path).toBe("/tmp/mock-workspaces/task-1");
    });

    it("returns undefined for an unknown path", () => {
      expect(manager.get("/unknown")).toBeUndefined();
    });
  });

  describe("list", () => {
    it("returns all registered handles", async () => {
      const h1 = await manager.create("task-1");
      const h2 = await manager.create("task-2");

      const handles = manager.list();
      expect(handles).toHaveLength(2);
      expect(handles.map((h) => h.path).sort()).toEqual([h1.path, h2.path].sort());
    });

    it("returns an empty array when no workspaces exist", () => {
      expect(manager.list()).toEqual([]);
    });
  });
  describe("session path tracking", () => {
    let manager: WorkspaceManager;

    beforeEach(async () => {
      provider = new MockWorkspaceProvider();
      const registry = new MockWorktreeRegistry();
      await registry.load();
      manager = new WorkspaceManager(provider, registry);
    });

    it("trackPath adds to listSessionPaths", () => {
      manager.trackPath("/tmp/ws-1");
      manager.trackPath("/tmp/ws-2");

      expect(manager.listSessionPaths()).toEqual(["/tmp/ws-1", "/tmp/ws-2"]);
    });

    it("untrackPath removes from listSessionPaths", () => {
      manager.trackPath("/tmp/ws-1");
      manager.trackPath("/tmp/ws-2");
      manager.untrackPath("/tmp/ws-1");

      expect(manager.listSessionPaths()).toEqual(["/tmp/ws-2"]);
    });

    it("untrackPath is a no-op for unknown paths", () => {
      manager.trackPath("/tmp/ws-1");
      manager.untrackPath("/tmp/nonexistent");

      expect(manager.listSessionPaths()).toEqual(["/tmp/ws-1"]);
    });

    it("listSessionPaths returns empty when nothing tracked", () => {
      expect(manager.listSessionPaths()).toEqual([]);
    });

    it("list returns all registry entries (not just session paths)", async () => {
      // list() returns registry entries, listSessionPaths() returns tracked only
      await manager.create("ws-1");
      await manager.create("ws-2");

      const allPaths = manager.list().map((h) => h.path);
      expect(allPaths.length).toBe(2);
      // Session paths are auto-tracked by create()
      expect(manager.listSessionPaths().length).toBe(2);
    });

    it("destroy removes from session paths", async () => {
      const handle = await manager.create("ws-1");
      const path = handle.path;

      expect(manager.listSessionPaths()).toContain(path);

      await manager.destroy(path);

      expect(manager.listSessionPaths()).not.toContain(path);
    });
  });
});
