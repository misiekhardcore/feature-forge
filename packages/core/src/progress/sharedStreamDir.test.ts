import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ForgeConfig } from "../config";
import { SharedStreamDir } from "./sharedStreamDir";

describe("SharedStreamDir", () => {
  let baseDir: string;

  /** Reset module-level state so each test starts from a clean singleton. */
  function resetState(): void {
    (SharedStreamDir as unknown as { instance: string | undefined }).instance = undefined;
    (SharedStreamDir as unknown as { _swept: boolean })._swept = false;
  }

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "shared-stream-dir-test-"));
    resetState();
  });

  afterEach(() => {
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

  /** Point config at the test baseDir with the given retention window. */
  function mockConfig(retentionDays: number): void {
    vi.spyOn(ForgeConfig, "getInstance").mockReturnValue({
      getLogDir: () => baseDir,
      getLogRetentionDays: () => retentionDays,
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
    it("keeps the current singleton and dirs within the retention window", () => {
      mockConfig(7);
      const dir = SharedStreamDir.get(baseDir);
      const recent = makeStaleDir("agent-streams-recent", 1);

      SharedStreamDir.cleanup();

      expect(existsSync(dir)).toBe(true);
      expect(existsSync(recent)).toBe(true);
    });

    it("prunes agent-streams dirs older than the retention window", () => {
      mockConfig(7);
      SharedStreamDir.get(baseDir);
      const stale = makeStaleDir("agent-streams-stale", 10);

      SharedStreamDir.cleanup();

      expect(existsSync(stale)).toBe(false);
    });

    it("retentionDays=0 disables pruning", () => {
      mockConfig(0);
      const stale = makeStaleDir("agent-streams-stale", 10);

      SharedStreamDir.cleanup();

      expect(existsSync(stale)).toBe(true);
    });

    it("is idempotent", () => {
      mockConfig(7);
      SharedStreamDir.get(baseDir);

      expect(() => {
        SharedStreamDir.cleanup();
        SharedStreamDir.cleanup();
      }).not.toThrow();
    });

    it("swallows rmSync failure while pruning a stale dir", () => {
      mockConfig(7);
      const stale = makeStaleDir("agent-streams-stale", 10);
      // Make the dir read-only so rmSync fails with EACCES.
      chmodSync(stale, 0o555);
      try {
        expect(() => SharedStreamDir.cleanup()).not.toThrow();
        expect(existsSync(stale)).toBe(true);
      } finally {
        chmodSync(stale, 0o755);
      }
    });
  });

  describe("sweepAndPrune", () => {
    it("removes empty agent-streams dirs on first get", () => {
      const stale = join(baseDir, "agent-streams-stale");
      mkdirSync(stale);

      const dir = SharedStreamDir.get(baseDir);

      expect(existsSync(stale)).toBe(false);
      expect(existsSync(dir)).toBe(true);
    });

    it("keeps non-empty agent-streams dirs within the retention window", () => {
      const stale = makeStaleDir("agent-streams-stale", 1);
      mockConfig(7);

      SharedStreamDir.get(baseDir);

      expect(existsSync(stale)).toBe(true);
    });

    it("prunes old non-empty agent-streams dirs", () => {
      const stale = makeStaleDir("agent-streams-stale", 10);
      mockConfig(7);

      SharedStreamDir.get(baseDir);

      expect(existsSync(stale)).toBe(false);
    });

    it("prunes old dirs but skips the current singleton", () => {
      const current = SharedStreamDir.get(baseDir);
      // Age the singleton too — it must still be skipped by the instance check.
      const old = new Date(Date.now() - 10 * 86_400_000);
      utimesSync(current, old, old);
      const stale = makeStaleDir("agent-streams-stale", 10);
      mockConfig(7);

      // Re-arm the once-per-process guard so the sweep runs again with the
      // singleton already created (the sweep would otherwise have run before
      // the first get() created it).
      (SharedStreamDir as unknown as { _swept: boolean })._swept = false;

      SharedStreamDir.get(baseDir);

      expect(existsSync(stale)).toBe(false);
      expect(existsSync(current)).toBe(true);
    });

    it("retentionDays=0 disables pruning", () => {
      const stale = makeStaleDir("agent-streams-stale", 10);
      mockConfig(0);

      SharedStreamDir.get(baseDir);

      expect(existsSync(stale)).toBe(true);
    });

    it("runs the sweep only once per process", () => {
      const first = join(baseDir, "agent-streams-first");
      mkdirSync(first);

      SharedStreamDir.get(baseDir);
      expect(existsSync(first)).toBe(false);

      // The guard is set after the first sweep — a dir created afterwards
      // survives subsequent get() calls.
      const second = join(baseDir, "agent-streams-second");
      mkdirSync(second);
      SharedStreamDir.get(baseDir);
      expect(existsSync(second)).toBe(true);
    });
  });
});
