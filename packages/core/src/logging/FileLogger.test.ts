import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveConfig } from "../config/ForgeConfigDefaults";
import { ForgeConfigLoader } from "../config/ForgeConfigLoader";
import type { ForgeConfig } from "../config/ForgeConfigSchema";
import { LogLevel } from "../config/ForgeConfigSchema";
import { jsonParse } from "../helpers";
import { FileLogger } from "./FileLogger";
import { Logger, logger as moduleLogger } from "./Logger";
import { RotatingFileSink } from "./RotatingFileSink";

describe("FileLogger", () => {
  let filePath: string;
  let logger: FileLogger;
  let logDir: string;
  let config: ForgeConfig;

  beforeEach(() => {
    filePath = join(
      tmpdir(),
      `forge-test-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
    );
    // Isolate the configured log dir in a temp directory: the production
    // path (no filePath) and both prune routines must never touch the
    // real .forge/logs during tests.
    logDir = mkdtempSync(join(tmpdir(), "forge-logdir-"));
    // Fully-resolved config pointing at the temp dir. Retention is forced
    // to 0 so initialize()'s pruneOldLogs call returns before touching any
    // log dir, while keeping the initialize -> pruneOldLogs wiring (with
    // the configured retention and current file path) covered. The
    // pruneOldLogs and pruneStaleProcessLogs describes replace this config
    // with their own.
    config = resolveConfig({
      logDir,
      logPrefix: "forge",
      logLevel: LogLevel.INFO,
      logRetentionDays: 0,
      logMaxBytes: 10 * 1024 * 1024,
      logMaxFiles: 5,
    });
    logger = FileLogger.initialize(config, filePath);
    Logger.setLogLevel(LogLevel.DEBUG);
  });

  afterEach(async () => {
    // Level filtering is set via Logger.setLogLevel() in individual tests
    await logger.close();
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
    rmSync(logDir, { recursive: true, force: true });
  });

  function readLines(): Record<string, unknown>[] {
    const content = readFileSync(filePath, "utf-8").trim();
    if (!content) return [];
    return content.split("\n").map((line) => jsonParse(line));
  }

  describe("construction", () => {
    it("creates the log file on first write", async () => {
      expect(existsSync(filePath)).toBe(false);
      logger.info("hello");
      await logger.close();
      expect(existsSync(filePath)).toBe(true);
    });
  });

  describe("JSON Lines output", () => {
    it("writes a JSON object per line for each log call", async () => {
      logger.error("err");
      logger.warn("wrn");
      logger.info("inf");
      logger.debug("dbg");
      await logger.close();

      const lines = readLines();
      expect(lines).toHaveLength(4);

      expect(lines[0].level).toBe("error");
      expect(lines[0].message).toBe("err");

      expect(lines[1].level).toBe("warn");
      expect(lines[1].message).toBe("wrn");

      expect(lines[2].level).toBe("info");
      expect(lines[2].message).toBe("inf");

      expect(lines[3].level).toBe("debug");
      expect(lines[3].message).toBe("dbg");
    });

    it("includes an ISO 8601 timestamp in every entry", async () => {
      logger.info("with time");
      await logger.close();

      const lines = readLines();
      expect(lines).toHaveLength(1);
      expect(lines[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it("includes optional data when provided", async () => {
      logger.error("with data", { userId: 42, details: { action: "click" } });
      await logger.close();

      const lines = readLines();
      expect(lines[0].data).toEqual({ userId: 42, details: { action: "click" } });
    });

    it("omits data field when not provided", async () => {
      logger.info("no data");
      await logger.close();

      const lines = readLines();
      expect(lines[0].data).toBeUndefined();
    });

    it("appends to existing file instead of overwriting", async () => {
      logger.info("first");
      await logger.close();

      const logger2 = FileLogger.initialize(config, filePath);
      logger2.info("second");
      await logger2.close();

      const lines = readLines();
      expect(lines).toHaveLength(2);
      expect(lines[0].message).toBe("first");
      expect(lines[1].message).toBe("second");
    });

    it("writes each entry as a single line of valid JSON", async () => {
      logger.error("line test", { key: "value" });
      await logger.close();

      const raw = readFileSync(filePath, "utf-8");
      const trimmed = raw.trim();
      const lines = trimmed.split("\n");
      expect(lines).toHaveLength(1);
      expect(() => jsonParse(lines[0])).not.toThrow();
      expect(raw.endsWith("\n")).toBe(true);
    });
  });

  describe("writes all levels", () => {
    it("writes debug, info, warn, and error entries", async () => {
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");
      await logger.close();

      const lines = readLines();
      expect(lines).toHaveLength(4);
      expect(lines.map((l) => l.level)).toEqual(["debug", "info", "warn", "error"]);
    });
  });

  describe("level filtering", () => {
    it("writes all levels when threshold is debug", async () => {
      const l = FileLogger.initialize(config, filePath);
      Logger.setLogLevel(LogLevel.DEBUG);
      l.error("e");
      l.warn("w");
      l.info("i");
      l.debug("d");
      await l.close();

      const lines = readLines();
      expect(lines).toHaveLength(4);
      expect(lines.map((entry) => entry.level)).toEqual(["error", "warn", "info", "debug"]);
    });

    it("filters debug entries when threshold is info", async () => {
      const l = FileLogger.initialize(config, filePath);
      Logger.setLogLevel(LogLevel.INFO);
      l.error("e");
      l.warn("w");
      l.info("i");
      l.debug("d");
      await l.close();

      const lines = readLines();
      expect(lines).toHaveLength(3);
      expect(lines.map((entry) => entry.level)).toEqual(["error", "warn", "info"]);
    });

    it("filters info and debug when threshold is warn", async () => {
      const l = FileLogger.initialize(config, filePath);
      Logger.setLogLevel(LogLevel.WARN);
      l.error("e");
      l.warn("w");
      l.info("i");
      l.debug("d");
      await l.close();

      const lines = readLines();
      expect(lines).toHaveLength(2);
      expect(lines.map((entry) => entry.level)).toEqual(["error", "warn"]);
    });

    it("filters everything except error when threshold is error", async () => {
      const l = FileLogger.initialize(config, filePath);
      Logger.setLogLevel(LogLevel.ERROR);
      l.error("e");
      l.warn("w");
      l.info("i");
      l.debug("d");
      await l.close();

      const lines = readLines();
      expect(lines).toHaveLength(1);
      expect(lines.map((entry) => entry.level)).toEqual(["error"]);
    });

    it("does not create a file when no entry meets the threshold", async () => {
      const l = FileLogger.initialize(config, filePath);
      Logger.setLogLevel(LogLevel.ERROR);
      l.warn("w");
      l.info("i");
      l.debug("d");
      await l.close();

      expect(existsSync(filePath)).toBe(false);
    });

    it("does not create a file on construction regardless of level", () => {
      FileLogger.initialize(config, filePath);
      Logger.setLogLevel(LogLevel.ERROR);
      expect(existsSync(filePath)).toBe(false);
    });
  });

  describe("default log file path", () => {
    it("resolves forge.<day>.<pid>.log under the configured log dir", () => {
      const defaultPath = FileLogger.getDefaultLogFilePath(config);
      expect(dirname(defaultPath)).toBe(logDir);
      expect(basename(defaultPath)).toMatch(/^forge\.\d{4}-\d{2}-\d{2}\.\d+\.log$/);
    });
  });

  describe("edge cases", () => {
    it("handles empty message gracefully", async () => {
      logger.info("");
      await logger.close();

      const lines = readLines();
      expect(lines[0].message).toBe("");
    });

    it("handles messages with special characters", async () => {
      const msg = 'Line 1\nLine 2\twith "quotes" and \\backslashes';
      logger.error(msg);
      await logger.close();

      const lines = readLines();
      expect(lines[0].message).toBe(msg);
    });

    it("handles circular data by catching serialization errors", () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      // Must not throw — the serializer catches the circular reference error.
      expect(() => logger.error("circular data", circular)).not.toThrow();
    });

    it("close is safe to call multiple times", async () => {
      logger.info("before close");
      await logger.close();
      await logger.close(); // second call should not throw
    });

    it("keeps the bare basename when the explicit path has no extension", async () => {
      const noExtPath = join(
        tmpdir(),
        `forge-noext-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      const noExtLogger = FileLogger.initialize(config, noExtPath);
      noExtLogger.info("no extension");
      await noExtLogger.close();

      // The documented contract: a path without an extension keeps its bare
      // basename - never a trailing dot ("foo.") or a "foo." segment.
      expect(existsSync(noExtPath)).toBe(true);
      expect(existsSync(`${noExtPath}.`)).toBe(false);
      expect(existsSync(`${noExtPath}.1`)).toBe(false);
      unlinkSync(noExtPath);
    });

    it("writes after close are best-effort and do not throw", async () => {
      await logger.close();
      expect(() => logger.info("after close")).not.toThrow();
      expect(() => logger.error("after close", { detail: true })).not.toThrow();
    });

    it("silently drops writes when stream is destroyed", async () => {
      logger.info("before close");
      await logger.close();
      // After close the stream is destroyed — writes must not throw
      logger.warn("after close warn");
      logger.debug("after close debug");

      // Only the pre-close entry should be in the file
      const lines = readLines();
      expect(lines).toHaveLength(1);
      expect(lines[0].message).toBe("before close");
    });

    it("handles undefined data explicitly", async () => {
      logger.warn("explicit undefined", undefined);
      await logger.close();

      const lines = readLines();
      expect(lines[0].data).toBeUndefined();
    });

    it("handles null-like values in data", async () => {
      logger.info("nulls", { a: null, b: 0, c: false });
      await logger.close();

      const lines = readLines();
      expect(lines[0].data).toEqual({ a: null, b: 0, c: false });
    });
  });

  describe("pruneOldLogs", () => {
    let logDir: string;
    let config: ForgeConfig;

    beforeEach(() => {
      logDir = mkdtempSync(join(tmpdir(), "forge-prune-test-"));
      // Config pointing at the temp dir so pruning never touches the real
      // log directory (the worktree's .forge/logs symlinks to shared logs).
      config = resolveConfig({ logDir });
    });

    afterEach(() => {
      vi.restoreAllMocks();
      rmSync(logDir, { recursive: true, force: true });
    });

    /** Write a `.log` file with an mtime `daysOld` days in the past. */
    function writeLogFile(name: string, daysOld: number): string {
      const fullPath = join(logDir, name);
      writeFileSync(fullPath, "stale entry\n", "utf-8");
      const old = new Date(Date.now() - daysOld * 86_400_000);
      utimesSync(fullPath, old, old);
      return fullPath;
    }

    it("skips pruning entirely when retentionDays <= 0", () => {
      writeLogFile("forge-stale.log", 10);

      FileLogger.pruneOldLogs(config, 0);

      expect(existsSync(join(logDir, "forge-stale.log"))).toBe(true);
    });

    it("deletes files older than the retention window", () => {
      writeLogFile("forge-stale.log", 10);

      FileLogger.pruneOldLogs(config, 7);

      expect(existsSync(join(logDir, "forge-stale.log"))).toBe(false);
    });

    it("prunes rotated segments older than the retention window", () => {
      writeLogFile("forge-stale.log.1", 10);
      writeLogFile("forge-stale.log.2", 10);
      writeLogFile("forge-recent.log.1", 3);

      FileLogger.pruneOldLogs(config, 7);

      expect(existsSync(join(logDir, "forge-stale.log.1"))).toBe(false);
      expect(existsSync(join(logDir, "forge-stale.log.2"))).toBe(false);
      expect(existsSync(join(logDir, "forge-recent.log.1"))).toBe(true);
    });

    it("keeps files within the retention window", () => {
      writeLogFile("forge-recent.log", 3);

      FileLogger.pruneOldLogs(config, 7);

      expect(existsSync(join(logDir, "forge-recent.log"))).toBe(true);
    });

    it("skips subdirectories", () => {
      const subDir = join(logDir, "agent-streams-abc");
      mkdirSync(subDir);
      const old = new Date(Date.now() - 10 * 86_400_000);
      utimesSync(subDir, old, old);

      FileLogger.pruneOldLogs(config, 1);

      expect(existsSync(subDir)).toBe(true);
    });

    it("skips non-.log files", () => {
      const jsonPath = join(logDir, "forge-stale.json");
      writeFileSync(jsonPath, "{}\n", "utf-8");
      const old = new Date(Date.now() - 10 * 86_400_000);
      utimesSync(jsonPath, old, old);

      FileLogger.pruneOldLogs(config, 1);

      expect(existsSync(jsonPath)).toBe(true);
    });

    it("skips the current file path", () => {
      writeLogFile("forge-other.log", 10);
      const currentPath = writeLogFile("forge-current.log", 10);

      FileLogger.pruneOldLogs(config, 1, currentPath);

      expect(existsSync(join(logDir, "forge-other.log"))).toBe(false);
      expect(existsSync(currentPath)).toBe(true);
    });

    it("survives stat failures without throwing", () => {
      const lockedPath = join(logDir, "forge-locked.log");
      writeFileSync(lockedPath, "locked\n", "utf-8");
      chmodSync(lockedPath, 0o000);
      const old = new Date(Date.now() - 10 * 86_400_000);
      utimesSync(lockedPath, old, old);
      // Strip write permission from the directory so the unlink also fails;
      // pruneOldLogs must swallow per-file failures and keep going.
      chmodSync(logDir, 0o555);

      try {
        expect(() => FileLogger.pruneOldLogs(config, 1)).not.toThrow();
      } finally {
        chmodSync(logDir, 0o755);
      }
    });

    it("handles a missing log dir gracefully", () => {
      const missingDir = join(
        tmpdir(),
        `forge-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      const missingConfig = resolveConfig({ logDir: missingDir });

      expect(() => FileLogger.pruneOldLogs(missingConfig, 1)).not.toThrow();
    });

    it("swallows ENOTDIR from a log dir path that is a regular file", () => {
      // Config logDir pointing at a regular file: the top-level readdirSync
      // throws ENOTDIR and must be caught (warn + return) instead of
      // escaping pruneOldLogs out of FileLogger.initialize().
      const filePath = join(logDir, "not-a-dir.log");
      writeFileSync(filePath, "x\n", "utf-8");
      const notADirConfig = resolveConfig({ logDir: filePath });
      const warnSpy = vi.spyOn(moduleLogger, "warn");

      expect(() => FileLogger.pruneOldLogs(notADirConfig, 7)).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Log retention: cannot read log directory ${filePath}`),
      );
    });

    it("logs a pruned summary even when nothing is pruned", () => {
      writeLogFile("forge-recent.log", 3);
      const infoSpy = vi.spyOn(moduleLogger, "info");

      FileLogger.pruneOldLogs(config, 7);

      expect(infoSpy).toHaveBeenCalledWith("Log retention: pruned 0 of 1 files older than 7 days");
    });

    it("does not log a summary when retention is disabled", () => {
      writeLogFile("forge-stale.log", 10);
      const infoSpy = vi.spyOn(moduleLogger, "info");

      FileLogger.pruneOldLogs(config, 0);

      expect(infoSpy).not.toHaveBeenCalled();
    });
  });

  describe("production sink (initialize without filePath)", () => {
    it("writes to forge.<day>.<pid>.log with rotation and an audit ledger", async () => {
      // Freeze the clock so the sink's internally computed day (naming) and
      // the test's expected day can never race across a midnight boundary.
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-03-02T10:00:00") });
      try {
        const prod = FileLogger.initialize(config, undefined, { maxBytes: 100, maxFiles: 3 });
        const message = "x".repeat(200);
        prod.info(message);
        prod.info(message);
        prod.info(message);
        await prod.close();

        const day = RotatingFileSink.dayKey(new Date());
        const base = `forge.${day}.${process.pid}.log`;
        const auditName = `.forge-${process.pid}-audit.json`;
        expect(readdirSync(logDir).sort()).toEqual(
          [base, `${base}.1`, `${base}.2`, auditName].sort(),
        );

        // Each rotated segment holds exactly one oversized entry.
        expect(readFileSync(join(logDir, base), "utf8").trim().split("\n")).toHaveLength(1);
        expect(
          readFileSync(join(logDir, `${base}.1`), "utf8")
            .trim()
            .split("\n"),
        ).toHaveLength(1);
        expect(
          readFileSync(join(logDir, `${base}.2`), "utf8")
            .trim()
            .split("\n"),
        ).toHaveLength(1);

        const audit = JSON.parse(readFileSync(join(logDir, auditName), "utf8")) as {
          files: Array<{ name: string }>;
        };
        expect(audit.files.map((file) => file.name)).toEqual([
          join(logDir, base),
          join(logDir, `${base}.1`),
          join(logDir, `${base}.2`),
        ]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("names the audit ledger after the configured log prefix", async () => {
      const configAgent42 = resolveConfig({
        logDir,
        logPrefix: "agent-42",
        logLevel: LogLevel.DEBUG,
        logRetentionDays: 0,
      });

      const prod = FileLogger.initialize(configAgent42, undefined);
      prod.info("hello");
      await prod.close();

      const auditName = `.agent-42-${process.pid}-audit.json`;
      expect(existsSync(join(logDir, auditName))).toBe(true);
      // The log file itself uses the configured prefix too.
      expect(
        readdirSync(logDir).some((name) => name.startsWith(`agent-42.`) && name.endsWith(".log")),
      ).toBe(true);
    });
  });

  describe("rotation and retention through FileLogger", () => {
    it("rotates an explicit-path logger into .N segments and caps them", async () => {
      const rot = FileLogger.initialize(config, filePath, { maxBytes: 100, maxFiles: 2 });
      const message = "x".repeat(200);
      for (let i = 0; i < 4; i++) {
        rot.info(message);
      }
      await rot.close();

      // 4 oversized writes: base, .1, .2, .3 are created; the maxFiles cap
      // of 2 numeric segments evicts the oldest (.1).
      expect(existsSync(filePath)).toBe(true);
      expect(existsSync(`${filePath}.2`)).toBe(true);
      expect(existsSync(`${filePath}.3`)).toBe(true);
      expect(existsSync(`${filePath}.1`)).toBe(false);

      const newest = JSON.parse(readFileSync(`${filePath}.3`, "utf8")) as { message: string };
      expect(newest.message).toBe(message);
    });
  });

  describe("pruneStaleProcessLogs", () => {
    let staleDir: string;
    let config: ForgeConfig;

    beforeEach(() => {
      staleDir = mkdtempSync(join(tmpdir(), "forge-stale-test-"));
      config = resolveConfig({
        logDir: staleDir,
        logPrefix: "forge",
        logRetentionDays: 0,
        logLevel: LogLevel.DEBUG,
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
      rmSync(staleDir, { recursive: true, force: true });
    });

    /** Spawn and reap a child so its pid is guaranteed dead. */
    function spawnDeadPid(): number {
      const child = spawnSync(process.execPath, ["-e", ""]);
      expect(child.status).toBe(0);
      return child.pid;
    }

    it("deletes audits and out-of-window logs of dead processes", () => {
      const pid = spawnDeadPid();
      const today = RotatingFileSink.dayKey(new Date());
      const oldDay = RotatingFileSink.dayKey(new Date(Date.now() - 10 * 86_400_000));
      writeFileSync(join(staleDir, `forge.${today}.${pid}.log`), "x\n");
      writeFileSync(join(staleDir, `forge.${oldDay}.${pid}.log`), "x\n");
      writeFileSync(join(staleDir, `.forge-${pid}-audit.json`), "{}\n");

      FileLogger.pruneStaleProcessLogs(config, staleDir);

      expect(existsSync(join(staleDir, `.forge-${pid}-audit.json`))).toBe(false);
      expect(existsSync(join(staleDir, `forge.${oldDay}.${pid}.log`))).toBe(false);
      // A single in-window segment is retained for diagnostics.
      expect(existsSync(join(staleDir, `forge.${today}.${pid}.log`))).toBe(true);
    });

    it("caps per-process-day segments to the newest RETAINED count", () => {
      const pid = spawnDeadPid();
      const today = RotatingFileSink.dayKey(new Date());
      const now = Date.now();
      const segments = [
        { name: `forge.${today}.${pid}.log`, age: 4000 },
        { name: `forge.${today}.${pid}.log.1`, age: 3000 },
        { name: `forge.${today}.${pid}.log.2`, age: 2000 },
        { name: `forge.${today}.${pid}.log.3`, age: 1000 },
      ];
      for (const segment of segments) {
        const fullPath = join(staleDir, segment.name);
        writeFileSync(fullPath, "x\n");
        const old = new Date(now - segment.age);
        utimesSync(fullPath, old, old);
      }

      FileLogger.pruneStaleProcessLogs(config, staleDir);

      // 4 segments for one pid:day - the oldest mtime (the base) is evicted.
      expect(existsSync(join(staleDir, `forge.${today}.${pid}.log`))).toBe(false);
      expect(existsSync(join(staleDir, `forge.${today}.${pid}.log.1`))).toBe(true);
      expect(existsSync(join(staleDir, `forge.${today}.${pid}.log.2`))).toBe(true);
      expect(existsSync(join(staleDir, `forge.${today}.${pid}.log.3`))).toBe(true);
    });

    it("never touches live-pid namespaces", () => {
      const today = RotatingFileSink.dayKey(new Date());
      writeFileSync(join(staleDir, `forge.${today}.${process.pid}.log`), "x\n");
      writeFileSync(join(staleDir, `.forge-${process.pid}-audit.json`), "{}\n");

      FileLogger.pruneStaleProcessLogs(config, staleDir);

      expect(existsSync(join(staleDir, `forge.${today}.${process.pid}.log`))).toBe(true);
      expect(existsSync(join(staleDir, `.forge-${process.pid}-audit.json`))).toBe(true);
    });

    it("initialize() prunes dead-pid namespaces from the configured log dir", () => {
      const pid = spawnDeadPid();
      const oldDay = RotatingFileSink.dayKey(new Date(Date.now() - 10 * 86_400_000));
      writeFileSync(join(staleDir, `forge.${oldDay}.${pid}.log`), "x\n");
      writeFileSync(join(staleDir, `.forge-${pid}-audit.json`), "{}\n");

      FileLogger.initialize(config, undefined);

      expect(existsSync(join(staleDir, `.forge-${pid}-audit.json`))).toBe(false);
      expect(existsSync(join(staleDir, `forge.${oldDay}.${pid}.log`))).toBe(false);
    });

    it("tolerates a missing log dir", () => {
      expect(() =>
        FileLogger.pruneStaleProcessLogs(
          config,
          join(tmpdir(), `forge-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`),
        ),
      ).not.toThrow();
    });
  });
});

describe("FileLogger with a real config file", () => {
  let scratchDir: string;
  let logsDir: string;
  let config: ForgeConfig;
  let prodLogger: FileLogger | undefined;

  beforeEach(async () => {
    scratchDir = mkdtempSync(join(tmpdir(), "forge-realconfig-"));
    logsDir = join(scratchDir, "logs");
    writeFileSync(
      join(scratchDir, "forge.config.json"),
      JSON.stringify({
        logLevel: "debug",
        logDir: logsDir,
        logMaxBytes: 200,
        logMaxFiles: 2,
      }),
    );
    config = await ForgeConfigLoader.load({ cwd: scratchDir });
  });

  afterEach(async () => {
    if (prodLogger) {
      await prodLogger.close();
      prodLogger = undefined;
    }
    rmSync(scratchDir, { recursive: true, force: true });
  });

  it("initialize() honors logMaxBytes/logMaxFiles from a real config file", async () => {
    prodLogger = FileLogger.initialize(config);
    const message = "y".repeat(150);
    for (let i = 0; i < 3; i++) {
      prodLogger.info(message);
    }
    await prodLogger.close();
    prodLogger = undefined;

    const day = RotatingFileSink.dayKey(new Date());
    const base = `forge.${day}.${process.pid}.log`;
    const audit = `.forge-${process.pid}-audit.json`;
    const files = readdirSync(logsDir).sort();

    // maxBytes 200 with ~219-byte entries rotates on every write; maxFiles 2
    // (audit mode: total incl. the base) evicts the base, keeping only the
    // two newest segments plus the ledger.
    expect(files).toContain(audit);
    expect(files.filter((name) => name.startsWith(base))).toEqual([`${base}.1`, `${base}.2`]);
    expect(existsSync(join(logsDir, base))).toBe(false);

    const parsed = JSON.parse(readFileSync(join(logsDir, audit), "utf8")) as {
      files: Array<{ name: string }>;
    };
    expect(parsed.files.map((file) => file.name)).toEqual([
      join(logsDir, `${base}.1`),
      join(logsDir, `${base}.2`),
    ]);
  });
});
