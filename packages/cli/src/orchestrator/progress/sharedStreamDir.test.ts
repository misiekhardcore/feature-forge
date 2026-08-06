import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ForgeConfig } from "@feature-forge/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SharedStreamDir } from "./sharedStreamDir";

describe("SharedStreamDir", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "shared-stream-dir-test-"));
  });

  afterEach(() => {
    SharedStreamDir.cleanup();
    vi.restoreAllMocks();
    rmSync(baseDir, { recursive: true, force: true });
  });

  /** Create a non-empty `agent-streams-*` dir with an mtime `daysOld` days in the past. */
  function makeStaleDir(name: string, daysOld: number): string {
    const dirPath = join(baseDir, name);
    mkdirSync(dirPath);
    writeFileSync(join(dirPath, "x.stream"), "line\n", "utf-8");
    const old = new Date(Date.now() - daysOld * 86_400_000);
    utimesSync(dirPath, old, old);
    return dirPath;
  }

  function mockRetentionDays(days: number): void {
    vi.spyOn(ForgeConfig, "getInstance").mockReturnValue({
      getLogRetentionDays: () => days,
    } as unknown as ForgeConfig);
  }

  describe("get", () => {
    it("creates an agent-streams dir under baseDir", () => {
      const dir = SharedStreamDir.get(baseDir);

      expect(dir.startsWith(join(baseDir, "agent-streams-"))).toBe(true);
      expect(existsSync(dir)).toBe(true);
    });

    it("returns the same singleton dir on repeated calls", () => {
      const first = SharedStreamDir.get(baseDir);
      const second = SharedStreamDir.get(baseDir);

      expect(second).toBe(first);
    });
  });

  describe("cleanup", () => {
    it("removes the singleton dir and resets the instance", () => {
      const dir = SharedStreamDir.get(baseDir);
      expect(existsSync(dir)).toBe(true);

      SharedStreamDir.cleanup();

      expect(existsSync(dir)).toBe(false);
      // A subsequent get() must create a fresh directory.
      const fresh = SharedStreamDir.get(baseDir);
      expect(fresh).not.toBe(dir);
    });

    it("is idempotent", () => {
      SharedStreamDir.get(baseDir);
      SharedStreamDir.cleanup();

      expect(() => SharedStreamDir.cleanup()).not.toThrow();
    });

    it("survives rmSync failure", () => {
      // Point the instance at a path whose parent is a regular file so
      // rmSync fails with ENOTDIR; cleanup must swallow the error.
      const blocker = join(baseDir, "blocker");
      writeFileSync(blocker, "blocker", "utf-8");
      const badPath = join(blocker, "child");
      (SharedStreamDir as unknown as { instance: string | undefined }).instance = badPath;

      expect(() => SharedStreamDir.cleanup()).not.toThrow();
    });
  });

  describe("sweepAndPrune", () => {
    it("removes empty agent-streams dirs on get", () => {
      const stale = join(baseDir, "agent-streams-stale");
      mkdirSync(stale);

      const dir = SharedStreamDir.get(baseDir);

      expect(existsSync(stale)).toBe(false);
      expect(existsSync(dir)).toBe(true);
    });

    it("keeps non-empty agent-streams dirs within the retention window", () => {
      const stale = makeStaleDir("agent-streams-stale", 1);
      mockRetentionDays(7);

      SharedStreamDir.get(baseDir);

      expect(existsSync(stale)).toBe(true);
    });

    it("prunes old non-empty agent-streams dirs", () => {
      const stale = makeStaleDir("agent-streams-stale", 10);
      mockRetentionDays(7);

      SharedStreamDir.get(baseDir);

      expect(existsSync(stale)).toBe(false);
    });

    it("prunes old dirs but skips the current singleton", () => {
      const current = SharedStreamDir.get(baseDir);
      // Age the singleton too — it must still be skipped by the instance check.
      const old = new Date(Date.now() - 10 * 86_400_000);
      utimesSync(current, old, old);
      const stale = makeStaleDir("agent-streams-stale", 10);
      mockRetentionDays(7);

      SharedStreamDir.get(baseDir);

      expect(existsSync(stale)).toBe(false);
      expect(existsSync(current)).toBe(true);
    });

    it("retentionDays=0 disables pruning", () => {
      const stale = makeStaleDir("agent-streams-stale", 10);
      mockRetentionDays(0);

      SharedStreamDir.get(baseDir);

      expect(existsSync(stale)).toBe(true);
    });
  });
});
