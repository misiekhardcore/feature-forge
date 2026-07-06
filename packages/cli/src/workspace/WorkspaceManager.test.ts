import { beforeEach, describe, expect, it } from "vitest";

import { MockWorkspaceProvider, MockWorktreeRegistry } from "../test-utils";
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
        'No workspace found with id "/nonexistent"',
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
});
