import { describe, expect, it, vi } from "vitest";

import { LogLevel } from "../config/ForgeConfigSchema";
import { Logger } from "./Logger";

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

  describe("console fallback", () => {
    it("prints to the console while the base logger is the active instance", () => {
      Logger.resetForTest();
      const logger = Logger.initialize();
      Logger.setLogLevel(LogLevel.DEBUG);

      const spies = {
        error: vi.spyOn(console, "error").mockImplementation(() => {}),
        warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
        info: vi.spyOn(console, "info").mockImplementation(() => {}),
        debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
      };
      try {
        logger.error("err msg", { key: "e" });
        logger.warn("warn msg");
        logger.info("info msg", { key: "i" });
        logger.debug("debug msg");

        expect(spies.error).toHaveBeenCalledWith("err msg", { key: "e" });
        expect(spies.warn).toHaveBeenCalledWith("warn msg");
        expect(spies.info).toHaveBeenCalledWith("info msg", { key: "i" });
        expect(spies.debug).toHaveBeenCalledWith("debug msg");
      } finally {
        for (const spy of Object.values(spies)) spy.mockRestore();
      }
    });

    it("omits undefined data from console calls", () => {
      Logger.resetForTest();
      const logger = Logger.initialize();

      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      try {
        logger.info("no data");
        expect(infoSpy).toHaveBeenCalledWith("no data");
        expect(infoSpy).not.toHaveBeenCalledWith("no data", undefined);
      } finally {
        infoSpy.mockRestore();
      }
    });

    it("suppresses entries below the configured threshold", () => {
      Logger.resetForTest();
      const logger = Logger.initialize();
      Logger.setLogLevel(LogLevel.ERROR);

      const spies = {
        warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
        info: vi.spyOn(console, "info").mockImplementation(() => {}),
        debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
        error: vi.spyOn(console, "error").mockImplementation(() => {}),
      };
      try {
        logger.warn("warn msg");
        logger.info("info msg");
        logger.debug("debug msg");
        logger.error("err msg");

        expect(spies.warn).not.toHaveBeenCalled();
        expect(spies.info).not.toHaveBeenCalled();
        expect(spies.debug).not.toHaveBeenCalled();
        expect(spies.error).toHaveBeenCalledWith("err msg");
      } finally {
        for (const spy of Object.values(spies)) spy.mockRestore();
      }
    });
  });

  describe("getLogLevel", () => {
    it("defaults to INFO when no logger instance or level exists (total)", () => {
      Logger.resetForTest();
      expect(Logger.getLogLevel()).toBe(LogLevel.INFO);
    });

    it("returns the level set on the active instance", () => {
      Logger.resetForTest();
      Logger.initialize();
      Logger.setLogLevel(LogLevel.DEBUG);
      expect(Logger.getLogLevel()).toBe(LogLevel.DEBUG);
    });
  });

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
