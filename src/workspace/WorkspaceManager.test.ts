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
      expect(handle.id).toBe("task-1");
      expect(handle.path).toBe("/tmp/mock-workspaces/task-1");
      expect(handle.createdAt).toBeInstanceOf(Date);
      expect(registry.get("task-1")).toBeDefined();
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
      expect(registry.get("task-1")).toBeUndefined();
    });
  });

  describe("destroy", () => {
    it("removes a previously created workspace from the registry", async () => {
      await manager.create("task-1");
      expect(registry.get("task-1")).toBeDefined();

      await manager.destroy("task-1");

      expect(registry.get("task-1")).toBeUndefined();
    });

    it("throws for an unknown workspace id", async () => {
      await expect(manager.destroy("nonexistent")).rejects.toThrow(
        'No workspace found with id "nonexistent"',
      );
    });
  });

  describe("get", () => {
    it("returns a handle for a registered workspace", async () => {
      await manager.create("task-1");
      const found = manager.get("task-1");

      expect(found).toBeInstanceOf(WorkspaceHandle);
      expect(found!.id).toBe("task-1");
    });

    it("returns undefined for an unknown workspace", () => {
      expect(manager.get("unknown")).toBeUndefined();
    });
  });

  describe("list", () => {
    it("returns all registered handles", async () => {
      await manager.create("task-1");
      await manager.create("task-2");

      const handles = manager.list();
      expect(handles).toHaveLength(2);
      expect(handles.map((h) => h.id).sort()).toEqual(["task-1", "task-2"]);
    });

    it("returns an empty array when no workspaces exist", () => {
      expect(manager.list()).toEqual([]);
    });
  });
});
