import { describe, expect, it } from "vitest";

import { LogLevel } from "../config";
import { Logger } from "./logger";
import { DEFAULT_LOG_LEVEL, levelSeverity, LOG_LEVEL_ORDER, shouldLog } from "./LogLevel";

describe("Logger", () => {
  /**
   * Minimal concrete Logger that captures every call for contract verification.
   */
  class TestLogger extends Logger {
    public calls: Array<{ method: string; message: string; data?: Record<string, unknown> }> = [];

    static initialize(): TestLogger {
      return new TestLogger();
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
});

describe("LogLevel", () => {
  describe("ordering", () => {
    it("ranks levels from most to least severe", () => {
      expect(LOG_LEVEL_ORDER).toEqual([
        LogLevel.SILENT,
        LogLevel.ERROR,
        LogLevel.WARN,
        LogLevel.INFO,
        LogLevel.DEBUG,
      ]);
    });

    it("assigns lower severity numbers to more severe levels", () => {
      expect(levelSeverity(LogLevel.ERROR)).toBe(1);
      expect(levelSeverity(LogLevel.WARN)).toBe(2);
      expect(levelSeverity(LogLevel.INFO)).toBe(3);
      expect(levelSeverity(LogLevel.DEBUG)).toBe(4);
    });
  });

  describe("shouldLog", () => {
    it("allows more severe levels through a less severe threshold", () => {
      expect(shouldLog(LogLevel.ERROR, LogLevel.INFO)).toBe(true);
      expect(shouldLog(LogLevel.WARN, LogLevel.DEBUG)).toBe(true);
    });

    it("blocks less severe levels below the threshold", () => {
      expect(shouldLog(LogLevel.DEBUG, LogLevel.WARN)).toBe(false);
      expect(shouldLog(LogLevel.INFO, LogLevel.ERROR)).toBe(false);
    });

    it("allows a level at its own threshold", () => {
      expect(shouldLog(LogLevel.ERROR, LogLevel.ERROR)).toBe(true);
      expect(shouldLog(LogLevel.DEBUG, LogLevel.DEBUG)).toBe(true);
    });
  });

  describe("DEFAULT_LOG_LEVEL", () => {
    it("is debug so all levels are written by default", () => {
      expect(DEFAULT_LOG_LEVEL).toBe(LogLevel.DEBUG);
    });
  });
});
