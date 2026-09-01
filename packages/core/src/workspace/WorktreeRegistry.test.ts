import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "../logging";
import { WorkspaceHandle } from "./WorkspaceHandle";
import { WorktreeRegistry } from "./WorktreeRegistry";
import { WorktreeRegistryCodec } from "./WorktreeRegistryCodec";

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn((_cmd, _args, _opts, callback) => {
    // Default: simulate a failed git command (not a git repo).
    // The promisify wrapper receives (err, ...values). For the default
    // error case we pass a single Error so promisify rejects.
    callback(new Error("Command failed: git"));
  }),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile: mockExecFile,
  };
});

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
    return new WorkspaceHandle(path, createdAt ?? new Date(), "forge/ws-test");
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

    it("round-trips sessionId through persist and load", async () => {
      const first = makeRegistry();
      await first.register(
        new WorkspaceHandle("/tmp/task-1", new Date(), "forge/ws-test", "sess-001"),
      );

      const second = makeRegistry();
      await second.load();

      expect(second.get("/tmp/task-1")!.sessionId).toBe("sess-001");
    });

    it("loads a v1 envelope file", async () => {
      writeFileSync(
        storagePath,
        JSON.stringify({
          version: 1,
          worktrees: [
            {
              path: "/tmp/a",
              createdAt: "2026-06-01T00:00:00.000Z",
              branch: "forge/ws-a",
              sessionId: "sess-1",
            },
            { path: "/tmp/b", createdAt: "2026-06-02T00:00:00.000Z", branch: "forge/ws-b" },
          ],
        }),
      );

      const registry = makeRegistry();
      await registry.load();

      expect(registry.getAll()).toHaveLength(2);
      expect(registry.get("/tmp/a")!.sessionId).toBe("sess-1");
      expect(registry.get("/tmp/b")!.branch).toBe("forge/ws-b");
    });

    it("migrates a v0 legacy array, keeping valid entries and dropping invalid ones", async () => {
      const warnSpy = vi.spyOn(logger, "warn");
      writeFileSync(
        storagePath,
        JSON.stringify([
          { path: "/tmp/legacy", createdAt: "2026-06-01T00:00:00.000Z" },
          {
            path: "/tmp/modern",
            createdAt: "2026-06-02T00:00:00.000Z",
            branch: "forge/ws-modern",
            sessionId: "sess-9",
          },
        ]),
      );

      const registry = makeRegistry();
      await registry.load();

      expect(registry.get("/tmp/legacy")).toBeUndefined();
      const modern = registry.get("/tmp/modern");
      expect(modern).toBeDefined();
      expect(modern!.branch).toBe("forge/ws-modern");
      expect(modern!.sessionId).toBe("sess-9");
      expect(warnSpy).toHaveBeenCalledWith(
        "Dropping invalid worktree registry entry during v0 migration",
        expect.objectContaining({
          entry: { path: "/tmp/legacy", createdAt: "2026-06-01T00:00:00.000Z" },
        }),
      );
      warnSpy.mockRestore();
    });

    it("keeps the first entry when the file contains duplicate paths", async () => {
      writeFileSync(
        storagePath,
        JSON.stringify({
          version: 1,
          worktrees: [
            { path: "/tmp/dup", createdAt: "2026-06-01T00:00:00.000Z", branch: "forge/ws-a" },
            { path: "/tmp/dup", createdAt: "2026-06-02T00:00:00.000Z", branch: "forge/ws-b" },
          ],
        }),
      );

      const registry = makeRegistry();
      await registry.load();

      expect(registry.getAll()).toHaveLength(1);
      expect(registry.get("/tmp/dup")!.branch).toBe("forge/ws-a");
    });

    it("starts empty and warns when the file cannot be read", async () => {
      // storagePath points at a directory - readFile fails with EISDIR.
      mkdirSync(storagePath, { recursive: true });
      const warnSpy = vi.spyOn(logger, "warn");

      const registry = makeRegistry();
      await expect(registry.load()).resolves.toBeUndefined();

      expect(registry.getAll()).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        "Failed to read worktree registry file; starting with an empty registry",
        expect.objectContaining({ path: storagePath }),
      );
      warnSpy.mockRestore();
    });

    it("starts empty and warns when the file contains invalid JSON", async () => {
      writeFileSync(storagePath, "not valid json {{{{");
      const warnSpy = vi.spyOn(logger, "warn");

      const registry = makeRegistry();
      await expect(registry.load()).resolves.toBeUndefined();

      expect(registry.getAll()).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        "Failed to parse worktree registry file; starting with an empty registry",
        expect.objectContaining({ path: storagePath }),
      );
      warnSpy.mockRestore();
    });

    it("starts empty and warns when the file is schema-invalid", async () => {
      writeFileSync(storagePath, JSON.stringify({ version: 2, worktrees: [] }));
      const warnSpy = vi.spyOn(logger, "warn");

      const registry = makeRegistry();
      await registry.load();

      expect(registry.getAll()).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        "Failed to parse worktree registry file; starting with an empty registry",
        expect.objectContaining({ path: storagePath }),
      );
      warnSpy.mockRestore();
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

    it("stamps sessionId from the provider when the handle has none", async () => {
      const registry = makeRegistry();
      await registry.load();
      registry.setSessionIdProvider(() => "sess-42");

      await registry.register(makeHandle("/tmp/task-1"));

      expect(registry.get("/tmp/task-1")!.sessionId).toBe("sess-42");
      const restored = makeRegistry();
      await restored.load();
      expect(restored.get("/tmp/task-1")!.sessionId).toBe("sess-42");
    });

    it("returns the stamped handle from register", async () => {
      const registry = makeRegistry();
      await registry.load();
      registry.setSessionIdProvider(() => "sess-42");

      const stored = await registry.register(makeHandle("/tmp/task-1"));

      expect(stored.path).toBe("/tmp/task-1");
      expect(stored.sessionId).toBe("sess-42");
      expect(registry.get("/tmp/task-1")).toBe(stored);
    });

    it("returns the original handle when no provider is set", async () => {
      const registry = makeRegistry();
      await registry.load();

      const handle = makeHandle("/tmp/task-1");
      const stored = await registry.register(handle);

      expect(stored).toBe(handle);
      expect(stored.sessionId).toBeUndefined();
    });

    it("does not override an existing sessionId", async () => {
      const registry = makeRegistry();
      await registry.load();
      registry.setSessionIdProvider(() => "sess-provider");

      await registry.register(
        new WorkspaceHandle("/tmp/task-1", new Date(), "forge/ws-test", "sess-handle"),
      );

      expect(registry.get("/tmp/task-1")!.sessionId).toBe("sess-handle");
      const restored = makeRegistry();
      await restored.load();
      expect(restored.get("/tmp/task-1")!.sessionId).toBe("sess-handle");
    });

    it("leaves sessionId unset when the provider returns undefined", async () => {
      const registry = makeRegistry();
      await registry.load();
      registry.setSessionIdProvider(() => undefined);

      await registry.register(makeHandle("/tmp/task-1"));

      expect(registry.get("/tmp/task-1")!.sessionId).toBeUndefined();
      const restored = makeRegistry();
      await restored.load();
      expect(restored.get("/tmp/task-1")!.sessionId).toBeUndefined();
    });
  });

  describe("persist", () => {
    it("writes the v1 envelope format", async () => {
      const registry = makeRegistry();
      await registry.load();
      await registry.register(makeHandle("/tmp/task-1"));

      const raw = JSON.parse(readFileSync(storagePath, "utf-8"));
      expect(raw).toEqual({
        version: 1,
        worktrees: [
          {
            path: "/tmp/task-1",
            createdAt: expect.any(String),
            branch: "forge/ws-test",
          },
        ],
      });
    });

    it("preserves entries written by another process after our last load (merge-on-write)", async () => {
      const registry = makeRegistry();
      await registry.load();
      await registry.register(makeHandle("/tmp/mine"));

      // Simulate a second pi session writing an entry we have not seen.
      writeFileSync(
        storagePath,
        WorktreeRegistryCodec.serialize([
          { path: "/tmp/other", createdAt: "2026-08-18T12:00:00.000Z", branch: "forge/ws-other" },
        ]),
      );

      await registry.register(makeHandle("/tmp/another"));

      const restored = makeRegistry();
      await restored.load();
      expect(restored.get("/tmp/mine")).toBeDefined();
      expect(restored.get("/tmp/other")).toBeDefined();
      expect(restored.get("/tmp/another")).toBeDefined();
    });

    it("serializes concurrent register calls (in-process mutex)", async () => {
      const registry = makeRegistry();
      await registry.load();

      await Promise.all(
        Array.from({ length: 20 }, (_, i) => registry.register(makeHandle(`/tmp/task-${i}`))),
      );

      const restored = makeRegistry();
      await restored.load();
      expect(restored.getAll()).toHaveLength(20);
    });

    it("serializes concurrent register and remove calls", async () => {
      const registry = makeRegistry();
      await registry.load();
      await registry.register(makeHandle("/tmp/keep"));

      await Promise.all([
        registry.register(makeHandle("/tmp/task-1")),
        registry.register(makeHandle("/tmp/task-2")),
        registry.remove("/tmp/task-1"),
      ]);

      const restored = makeRegistry();
      await restored.load();
      expect(restored.get("/tmp/keep")).toBeDefined();
      expect(restored.get("/tmp/task-1")).toBeUndefined();
      expect(restored.get("/tmp/task-2")).toBeDefined();
    });

    it("writes atomically via a temp file and leaves no temp files behind", async () => {
      const registry = makeRegistry();
      await registry.load();
      await registry.register(makeHandle("/tmp/task-1"));

      const leftovers = readdirSync(tmpDir).filter((name) => name.includes(".tmp-"));
      expect(leftovers).toEqual([]);
      expect(WorktreeRegistryCodec.parse(readFileSync(storagePath, "utf-8")).version).toBe(1);
    });

    it("self-heals a corrupt file on the next persist", async () => {
      writeFileSync(storagePath, "corrupt {{{");
      const registry = makeRegistry();
      await registry.load();
      expect(registry.getAll()).toEqual([]);

      await registry.register(makeHandle("/tmp/task-1"));

      const restored = makeRegistry();
      await restored.load();
      expect(restored.get("/tmp/task-1")).toBeDefined();
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

  describe("reconcile", () => {
    beforeEach(() => {
      mockExecFile.mockReset();
    });

    it("returns empty arrays when registry, disk, and git are clean", async () => {
      const registry = makeRegistry();
      await registry.load();
      await registry.register(makeHandle(join(tmpDir, "existing-workspace")));
      mkdirSync(join(tmpDir, "existing-workspace"));

      // No orphaned worktree dirs, and git won't find anything (not a repo).
      const report = await registry.reconcile(tmpDir);

      expect(report.staleRegistryEntries).toEqual([]);
      expect(report.orphanedWorktrees).toEqual([]);
      expect(report.orphanedBranches).toEqual([]);
    });

    it("detects stale registry entries whose paths do not exist on disk", async () => {
      const registry = makeRegistry();
      await registry.load();
      const missingPath = join(tmpDir, "nonexistent-workspace");
      // Do NOT create the directory — simulate a stale entry.
      await registry.register(makeHandle(missingPath));

      const report = await registry.reconcile(tmpDir);

      expect(report.staleRegistryEntries).toEqual([missingPath]);
      expect(report.orphanedWorktrees).toEqual([]);
      expect(report.orphanedBranches).toEqual([]);
    });

    it("detects orphaned worktree directories not in the registry", async () => {
      const registry = makeRegistry();
      await registry.load();
      // Create a worktree directory WITHOUT registering it.
      const orphanPath = join(tmpDir, ".forge", "worktrees", "orphan-ws");
      mkdirSync(orphanPath, { recursive: true });

      const report = await registry.reconcile(tmpDir);

      expect(report.orphanedWorktrees).toContain(orphanPath);
      expect(report.staleRegistryEntries).toEqual([]);
      expect(report.orphanedBranches).toEqual([]);
    });

    it("does not flag worktree directories that are tracked in registry", async () => {
      const registry = makeRegistry();
      await registry.load();
      const trackedPath = join(tmpDir, ".forge", "worktrees", "tracked-ws");
      mkdirSync(trackedPath, { recursive: true });
      await registry.register(makeHandle(trackedPath));

      const report = await registry.reconcile(tmpDir);

      expect(report.orphanedWorktrees).toEqual([]);
    });

    it("detects orphaned forge/* branches with no corresponding worktree", async () => {
      mockExecFile.mockImplementationOnce((_cmd, _args, _opts, callback) => {
        callback(null, { stdout: "  forge/ws-stale-branch\n", stderr: "" });
      });

      const registry = makeRegistry();
      await registry.load();

      const report = await registry.reconcile(tmpDir);

      expect(report.orphanedBranches).toEqual(["forge/ws-stale-branch"]);
      expect(report.staleRegistryEntries).toEqual([]);
      expect(report.orphanedWorktrees).toEqual([]);
    });

    it("excludes branches that are tracked by registry handles", async () => {
      mockExecFile.mockImplementationOnce((_cmd, _args, _opts, callback) => {
        callback(null, {
          stdout: "  forge/ws-tracked-branch\n  forge/ws-stale-branch\n",
          stderr: "",
        });
      });

      const registry = makeRegistry();
      await registry.load();
      const trackedPath = join(tmpDir, "tracked-workspace");
      mkdirSync(trackedPath);
      await registry.register(
        new WorkspaceHandle(trackedPath, new Date(), "forge/ws-tracked-branch"),
      );

      const report = await registry.reconcile(tmpDir);

      expect(report.orphanedBranches).toEqual(["forge/ws-stale-branch"]);
    });

    it("handles mixed state with all three mismatch types", async () => {
      mockExecFile.mockImplementationOnce((_cmd, _args, _opts, callback) => {
        callback(null, { stdout: "  forge/ws-orphan-branch\n", stderr: "" });
      });

      const registry = makeRegistry();
      await registry.load();

      // Stale entry: registered but path missing.
      const stalePath = join(tmpDir, "stale-ws");
      await registry.register(makeHandle(stalePath));

      // Orphaned worktree: directory exists but not registered.
      const orphanPath = join(tmpDir, ".forge", "worktrees", "orphan-ws");
      mkdirSync(orphanPath, { recursive: true });

      const report = await registry.reconcile(tmpDir);

      expect(report.staleRegistryEntries).toEqual([stalePath]);
      expect(report.orphanedWorktrees).toContain(orphanPath);
      expect(report.orphanedBranches).toEqual(["forge/ws-orphan-branch"]);
    });

    it("leaves orphanedBranches empty when git command fails", async () => {
      // The default mock already simulates a failed command, but we
      // override here to be explicit about the error being caught.
      mockExecFile.mockImplementationOnce((_cmd, _args, _opts, callback) => {
        callback(new Error("git not found"));
      });

      const registry = makeRegistry();
      await registry.load();
      const stalePath = join(tmpDir, "stale-ws");
      await registry.register(makeHandle(stalePath));

      const report = await registry.reconcile(tmpDir);

      expect(report.staleRegistryEntries).toEqual([stalePath]);
      expect(report.orphanedWorktrees).toEqual([]);
      expect(report.orphanedBranches).toEqual([]);
    });

    it("handles empty git branch output", async () => {
      mockExecFile.mockImplementationOnce((_cmd, _args, _opts, callback) => {
        callback(null, { stdout: "", stderr: "" });
      });

      const registry = makeRegistry();
      await registry.load();

      const report = await registry.reconcile(tmpDir);

      expect(report.orphanedBranches).toEqual([]);
    });

    it("ignores .forge/worktrees/ when the directory does not exist", async () => {
      const registry = makeRegistry();
      await registry.load();
      // tmpDir has no .forge/worktrees/ subdirectory.

      const report = await registry.reconcile(tmpDir);

      expect(report.orphanedWorktrees).toEqual([]);
    });

    it("derives repoRoot from storage path when not provided", async () => {
      // storagePath is `<tmpDir>/worktrees.json`, so derived repoRoot is `tmpdir()`.
      // Only verify we don't crash and the arrays are empty (no orphaned dirs).
      const registry = makeRegistry();
      await registry.load();

      const report = await registry.reconcile();

      // All arrays should be empty — no stale entries, no orphaned dirs, no branches.
      expect(report.staleRegistryEntries).toEqual([]);
      expect(report.orphanedWorktrees).toEqual([]);
      expect(report.orphanedBranches).toEqual([]);
    });

    it("reconcileAndLog stays silent when everything is in sync", async () => {
      const warnSpy = vi.spyOn(logger, "warn");
      const registry = makeRegistry();
      await registry.load();

      await registry.reconcileAndLog(tmpDir);

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("reconcileAndLog warns when mismatches are found", async () => {
      const warnSpy = vi.spyOn(logger, "warn");
      const registry = makeRegistry();
      await registry.load();
      const stalePath = join(tmpDir, "stale-ws");
      await registry.register(makeHandle(stalePath));

      await registry.reconcileAndLog(tmpDir);

      expect(warnSpy).toHaveBeenCalledWith(
        "[feature-forge] Worktree registry reconciliation found issues",
        expect.objectContaining({ staleRegistryEntries: [stalePath] }),
      );
      warnSpy.mockRestore();
    });
  });
});
