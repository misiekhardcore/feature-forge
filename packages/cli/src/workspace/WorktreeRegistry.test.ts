import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WorkspaceHandle } from "./WorkspaceHandle";
import { WorktreeRegistry } from "./WorktreeRegistry";

describe("WorktreeRegistry", () => {
  let tmpDir: string;
  let storagePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "worktree-registry-test-"));
    storagePath = join(tmpDir, "worktrees.json");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeRegistry(): WorktreeRegistry {
    return new WorktreeRegistry(storagePath);
  }

  function makeHandle(path: string, createdAt?: Date): WorkspaceHandle {
    return new WorkspaceHandle(path, createdAt ?? new Date());
  }

  describe("load", () => {
    it("starts empty when no persisted file exists", async () => {
      const registry = makeRegistry();
      await registry.load();
      expect(registry.getAll()).toEqual([]);
    });

    it("loads previously persisted data", async () => {
      const first = makeRegistry();
      await first.register(makeHandle("/tmp/task-1"));

      const second = makeRegistry();
      await second.load();

      const loaded = second.get("/tmp/task-1");
      expect(loaded).toBeDefined();
      expect(loaded!.path).toBe("/tmp/task-1");
    });

    it("loads multiple entries", async () => {
      const first = makeRegistry();
      await first.register(makeHandle("/tmp/task-1"));
      await first.register(makeHandle("/tmp/task-2"));
      await first.register(makeHandle("/tmp/task-3"));

      const second = makeRegistry();
      await second.load();

      expect(second.getAll()).toHaveLength(3);
      expect(second.get("/tmp/task-1")).toBeDefined();
      expect(second.get("/tmp/task-2")).toBeDefined();
      expect(second.get("/tmp/task-3")).toBeDefined();
    });

    it("replaces in-memory state with disk contents (does not accumulate)", async () => {
      const registry = makeRegistry();
      await registry.register(makeHandle("/tmp/entry-1"));
      await registry.register(makeHandle("/tmp/entry-2"));
      expect(registry.getAll()).toHaveLength(2);

      await registry.load();
      expect(registry.getAll()).toHaveLength(2);
      expect(registry.get("/tmp/entry-1")).toBeDefined();
      expect(registry.get("/tmp/entry-2")).toBeDefined();
    });

    it("preserves createdAt timestamp when loading", async () => {
      const date = new Date("2026-06-24T12:00:00.000Z");
      const first = makeRegistry();
      await first.register(makeHandle("/tmp/task-1", date));

      const second = makeRegistry();
      await second.load();

      const loaded = second.get("/tmp/task-1");
      expect(loaded!.createdAt.getTime()).toBe(date.getTime());
    });
  });

  describe("register", () => {
    it("adds a handle and makes it retrievable", async () => {
      const registry = makeRegistry();
      await registry.load();
      await registry.register(makeHandle("/tmp/task-1"));

      expect(registry.get("/tmp/task-1")).toBeDefined();
    });

    it("persists to disk so a new registry instance can load it", async () => {
      const first = makeRegistry();
      await first.load();
      await first.register(makeHandle("/tmp/persistent"));

      const second = makeRegistry();
      await second.load();
      expect(second.get("/tmp/persistent")).toBeDefined();
    });

    it("throws when registering a duplicate path", async () => {
      const registry = makeRegistry();
      await registry.load();
      await registry.register(makeHandle("/tmp/task-1"));

      await expect(registry.register(makeHandle("/tmp/task-1"))).rejects.toThrow(
        "Item already registered: /tmp/task-1",
      );
    });

    it("does not create duplicates when loading and re-registering same path", async () => {
      const first = makeRegistry();
      await first.register(makeHandle("/tmp/task-1"));

      const second = makeRegistry();
      await second.load();
      await expect(second.register(makeHandle("/tmp/task-1"))).rejects.toThrow(
        "Item already registered: /tmp/task-1",
      );
    });
  });

  describe("remove", () => {
    it("removes a registered handle", async () => {
      const registry = makeRegistry();
      await registry.load();
      await registry.register(makeHandle("/tmp/task-1"));
      expect(registry.get("/tmp/task-1")).toBeDefined();

      await registry.remove("/tmp/task-1");
      expect(registry.get("/tmp/task-1")).toBeUndefined();
    });

    it("persists removal to disk", async () => {
      const first = makeRegistry();
      await first.load();
      await first.register(makeHandle("/tmp/task-1"));
      await first.remove("/tmp/task-1");

      const second = makeRegistry();
      await second.load();
      expect(second.get("/tmp/task-1")).toBeUndefined();
    });

    it("is a no-op for non-existent paths", async () => {
      const registry = makeRegistry();
      await registry.load();

      await expect(registry.remove("/tmp/nonexistent")).resolves.toBeUndefined();
      expect(registry.getAll()).toEqual([]);
    });

    it("removing one entry leaves others intact", async () => {
      const registry = makeRegistry();
      await registry.load();
      await registry.register(makeHandle("/tmp/keep-me"));
      await registry.register(makeHandle("/tmp/remove-me"));
      await registry.remove("/tmp/remove-me");

      expect(registry.get("/tmp/remove-me")).toBeUndefined();
      expect(registry.get("/tmp/keep-me")).toBeDefined();
    });

    it("creates the parent directory if it does not exist", async () => {
      const nestedPath = join(tmpDir, "nested", "deep", "worktrees.json");
      const registry = new WorktreeRegistry(nestedPath);
      await registry.load();
      await registry.register(makeHandle("/tmp/task-1"));

      const restored = new WorktreeRegistry(nestedPath);
      await restored.load();
      expect(restored.get("/tmp/task-1")).toBeDefined();
    });
  });

  describe("defaultStoragePath", () => {
    it("resolves to .forge/worktrees.json under the given repoRoot", () => {
      const path = WorktreeRegistry.defaultStoragePath("/home/user/repo");
      expect(path).toBe("/home/user/repo/.forge/worktrees.json");
    });

    it("falls back to process.cwd() when repoRoot is omitted", () => {
      const path = WorktreeRegistry.defaultStoragePath();
      expect(path).toContain(".forge/worktrees.json");
      expect(path.startsWith(process.cwd())).toBe(true);
    });
  });

  describe("load error handling", () => {
    it("throws WorkspaceError when file contains invalid JSON", async () => {
      writeFileSync(storagePath, "not valid json {{{{");
      const registry = makeRegistry();
      await expect(registry.load()).rejects.toThrow(
        `Failed to load worktree registry from ${storagePath}`,
      );
    });
  });
});
