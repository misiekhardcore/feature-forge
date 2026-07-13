import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ForgeConfig } from "../config";
import { Logger } from "./Logger";
import { LogLevel } from "./LogLevel";

describe("Logger", () => {
  /**
   * Minimal concrete Logger that captures every call for contract verification.
   */
  class TestLogger extends Logger {
    public calls: Array<{ method: string; message: string; data?: Record<string, unknown> }> = [];

    static initialize(): TestLogger {
      const instance = new TestLogger();
      Logger.instance = instance;
      return instance;
    }

    /** Expose protected parseLogLevel for testing. */
    public parse(raw: string | undefined): LogLevel | undefined {
      return this.parseLogLevel(raw);
    }

    /** Expose protected shouldLog for testing. */
    public meetsThreshold(candidate: LogLevel, threshold: LogLevel): boolean {
      return this.shouldLog(candidate, threshold);
    }

    override error(message: string, data?: Record<string, unknown>): void {
      this.calls.push({ method: "error", message, data });
    }

    override warn(message: string, data?: Record<string, unknown>): void {
      this.calls.push({ method: "warn", message, data });
    }

    override info(message: string, data?: Record<string, unknown>): void {
      this.calls.push({ method: "info", message, data });
    }

    override debug(message: string, data?: Record<string, unknown>): void {
      this.calls.push({ method: "debug", message, data });
    }
  }

  describe("contract", () => {
    it("provides four severity methods", () => {
      const logger = TestLogger.initialize();
      expect(typeof logger.error).toBe("function");
      expect(typeof logger.warn).toBe("function");
      expect(typeof logger.info).toBe("function");
      expect(typeof logger.debug).toBe("function");
    });

    it("calls the correct method for each severity", () => {
      const logger = TestLogger.initialize();

      logger.error("error msg", { key: "e" });
      logger.warn("warn msg", { key: "w" });
      logger.info("info msg", { key: "i" });
      logger.debug("debug msg", { key: "d" });

      expect(logger.calls).toHaveLength(4);
      expect(logger.calls[0]).toEqual({
        method: "error",
        message: "error msg",
        data: { key: "e" },
      });
      expect(logger.calls[1]).toEqual({ method: "warn", message: "warn msg", data: { key: "w" } });
      expect(logger.calls[2]).toEqual({ method: "info", message: "info msg", data: { key: "i" } });
      expect(logger.calls[3]).toEqual({
        method: "debug",
        message: "debug msg",
        data: { key: "d" },
      });
    });

    it("accepts calls without optional data parameter", () => {
      const logger = TestLogger.initialize();
      logger.info("no data");
      expect(logger.calls[0]).toEqual({ method: "info", message: "no data", data: undefined });
    });
  });

  describe("log level resolution", () => {
    let tempDir: string;

    beforeEach(async () => {
      Logger.resetForTest();
      tempDir = mkdtempSync(join(tmpdir(), "forge-logger-test-"));
    });

    afterEach(() => {
      ForgeConfig.destroy();
      Logger.resetForTest();
    });

    it("reads log level from ForgeConfig when initialized", async () => {
      writeFileSync(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "error",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      await ForgeConfig.create({ cwd: tempDir });

      TestLogger.initialize();
      expect(Logger.getLogLevel()).toBe(LogLevel.ERROR);
    });

    it("reads info log level from ForgeConfig", async () => {
      writeFileSync(
        join(tempDir, "forge.config.json"),
        JSON.stringify({
          logLevel: "info",
          workspaceProvider: "git-worktree",
          agents: {},
          defaultAgent: { model: { model: "gpt-4" } },
        }),
      );

      await ForgeConfig.create({ cwd: tempDir });

      TestLogger.initialize();
      expect(Logger.getLogLevel()).toBe(LogLevel.INFO);
    });

    it("uses FORGE_LOG_LEVEL env var when ForgeConfig is not initialized", () => {
      ForgeConfig.destroy();
      const original = process.env.FORGE_LOG_LEVEL;
      process.env.FORGE_LOG_LEVEL = "warn";
      try {
        TestLogger.initialize();
        expect(Logger.getLogLevel()).toBe(LogLevel.WARN);
      } finally {
        if (original !== undefined) {
          process.env.FORGE_LOG_LEVEL = original;
        } else {
          delete process.env.FORGE_LOG_LEVEL;
        }
      }
    });

    it("falls back to DEFAULT_LOG_LEVEL when neither config nor env var is set", () => {
      ForgeConfig.destroy();
      const original = process.env.FORGE_LOG_LEVEL;
      delete process.env.FORGE_LOG_LEVEL;
      try {
        TestLogger.initialize();
        expect(Logger.getLogLevel()).toBe(LogLevel.DEBUG);
      } finally {
        if (original !== undefined) {
          process.env.FORGE_LOG_LEVEL = original;
        } else {
          delete process.env.FORGE_LOG_LEVEL;
        }
      }
    });
  });

  describe("forwarding from module-level logger", () => {
    beforeEach(() => {
      Logger.resetForTest();
    });

    afterEach(() => {
      Logger.resetForTest();
    });

    it("forwards severity calls to the active Logger.instance", () => {
      // Create the initial base Logger (simulates module-level export)
      const initial = Logger.initialize();

      // Replace the singleton with a concrete subclass
      const target = TestLogger.initialize();

      // Call severity methods on the original base Logger
      initial.error("fw err", { k: "e" });
      initial.warn("fw warn");
      initial.info("fw info", { k: "i" });
      initial.debug("fw debug");

      expect(target.calls).toHaveLength(4);
      expect(target.calls[0]).toEqual({ method: "error", message: "fw err", data: { k: "e" } });
      expect(target.calls[1]).toEqual({ method: "warn", message: "fw warn", data: undefined });
      expect(target.calls[2]).toEqual({ method: "info", message: "fw info", data: { k: "i" } });
      expect(target.calls[3]).toEqual({ method: "debug", message: "fw debug", data: undefined });
    });

    it("does not forward when the base Logger is the current instance", () => {
      const baseLogger = Logger.initialize();
      // At this point, Logger.instance === baseLogger. Calling methods
      // should not cause recursion or forward to itself.
      expect(() => {
        baseLogger.error("no-forward");
        baseLogger.warn("no-forward");
        baseLogger.info("no-forward");
        baseLogger.debug("no-forward");
      }).not.toThrow();
    });

    it("does not forward when Logger.instance is null", () => {
      const baseLogger = Logger.initialize();
      // Reset the singleton to simulate edge case
      Logger.resetForTest();

      expect(() => {
        baseLogger.error("no-instance");
        baseLogger.warn("no-instance");
      }).not.toThrow();
    });
  });

  describe("parseLogLevel", () => {
    let logger: TestLogger;

    beforeEach(() => {
      Logger.resetForTest();
      logger = TestLogger.initialize();
    });

    afterEach(() => {
      Logger.resetForTest();
    });

    it("returns undefined for undefined input", () => {
      expect(logger.parse(undefined)).toBeUndefined();
    });

    it("returns undefined for empty string input", () => {
      expect(logger.parse("")).toBeUndefined();
    });

    it("returns undefined for garbage input", () => {
      expect(logger.parse("not-a-level")).toBeUndefined();
    });

    it("parses valid level strings case-insensitively", () => {
      expect(logger.parse("ERROR")).toBe(LogLevel.ERROR);
      expect(logger.parse("error")).toBe(LogLevel.ERROR);
      expect(logger.parse("Error")).toBe(LogLevel.ERROR);
      expect(logger.parse("WARN")).toBe(LogLevel.WARN);
      expect(logger.parse("INFO")).toBe(LogLevel.INFO);
      expect(logger.parse("DEBUG")).toBe(LogLevel.DEBUG);
    });
  });

  describe("shouldLog", () => {
    let logger: TestLogger;

    beforeEach(() => {
      Logger.resetForTest();
      logger = TestLogger.initialize();
    });

    afterEach(() => {
      Logger.resetForTest();
    });

    it("returns true when candidate severity equals threshold", () => {
      expect(logger.meetsThreshold(LogLevel.ERROR, LogLevel.ERROR)).toBe(true);
    });

    it("returns true when candidate is more severe than threshold", () => {
      expect(logger.meetsThreshold(LogLevel.ERROR, LogLevel.WARN)).toBe(true);
    });

    it("returns false when candidate is less severe than threshold", () => {
      expect(logger.meetsThreshold(LogLevel.DEBUG, LogLevel.INFO)).toBe(false);
    });

    it("allows DEBUG with DEBUG threshold", () => {
      expect(logger.meetsThreshold(LogLevel.DEBUG, LogLevel.DEBUG)).toBe(true);
    });

    it("filters INFO entries when threshold is ERROR", () => {
      // INFO (2) is less severe than ERROR (0), so it should be filtered out
      expect(logger.meetsThreshold(LogLevel.INFO, LogLevel.ERROR)).toBe(false);
    });
  });
});
