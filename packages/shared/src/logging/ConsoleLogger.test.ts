import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ForgeConfig, LogLevel } from "../config";
import { ConsoleLogger } from "./ConsoleLogger";
import { Logger } from "./Logger";

describe("ConsoleLogger", () => {
  let logger: ConsoleLogger;

  beforeEach(() => {
    Logger.resetForTest();
    logger = ConsoleLogger.initialize();
    Logger.setLogLevel(LogLevel.DEBUG);
  });

  afterEach(() => {
    Logger.resetForTest();
  });

  describe("log methods", () => {
    it("returns void without throwing for error", () => {
      expect(() => logger.error("test")).not.toThrow();
      expect(logger.error("test")).toBeUndefined();
    });

    it("returns void without throwing for warn", () => {
      expect(() => logger.warn("test")).not.toThrow();
      expect(logger.warn("test")).toBeUndefined();
    });

    it("returns void without throwing for info", () => {
      expect(() => logger.info("test")).not.toThrow();
      expect(logger.info("test")).toBeUndefined();
    });

    it("returns void without throwing for debug", () => {
      expect(() => logger.debug("test")).not.toThrow();
      expect(logger.debug("test")).toBeUndefined();
    });

    it("accepts optional data parameter without side effects", () => {
      expect(() => logger.error("msg", { key: "value", nested: { deep: true } })).not.toThrow();
      expect(() => logger.warn("msg", { array: [1, 2, 3] })).not.toThrow();
      expect(() => logger.info("msg", undefined)).not.toThrow();
    });

    it("has zero observable side effects", () => {
      const before = { ...process.env };
      logger.error("should not appear anywhere");
      logger.info("still nothing");
      expect(process.env).toEqual(before);
    });
  });

  describe("level filtering", () => {
    let consoleSpies: {
      error: ReturnType<typeof vi.spyOn>;
      warn: ReturnType<typeof vi.spyOn>;
      info: ReturnType<typeof vi.spyOn>;
      debug: ReturnType<typeof vi.spyOn>;
    };

    beforeEach(() => {
      consoleSpies = {
        error: vi.spyOn(console, "error").mockImplementation(() => {}),
        warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
        info: vi.spyOn(console, "info").mockImplementation(() => {}),
        debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
      };
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("prints every severity at DEBUG level", () => {
      Logger.setLogLevel(LogLevel.DEBUG);
      logger.error("e", { n: 1 });
      logger.warn("w");
      logger.info("i");
      logger.debug("d");

      expect(consoleSpies.error).toHaveBeenCalledWith("e", { n: 1 });
      expect(consoleSpies.warn).toHaveBeenCalledWith("w", undefined);
      expect(consoleSpies.info).toHaveBeenCalledWith("i", undefined);
      expect(consoleSpies.debug).toHaveBeenCalledWith("d", undefined);
    });

    it("suppresses entries below the configured threshold", () => {
      Logger.setLogLevel(LogLevel.WARN);
      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");

      expect(consoleSpies.debug).not.toHaveBeenCalled();
      expect(consoleSpies.info).not.toHaveBeenCalled();
      expect(consoleSpies.warn).toHaveBeenCalledWith("w", undefined);
      expect(consoleSpies.error).toHaveBeenCalledWith("e", undefined);
    });

    it("suppresses everything at SILENT level", () => {
      Logger.setLogLevel(LogLevel.SILENT);
      logger.error("e");
      logger.warn("w");
      logger.info("i");
      logger.debug("d");

      expect(consoleSpies.error).not.toHaveBeenCalled();
      expect(consoleSpies.warn).not.toHaveBeenCalled();
      expect(consoleSpies.info).not.toHaveBeenCalled();
      expect(consoleSpies.debug).not.toHaveBeenCalled();
    });

    it("falls back to the configured log level when none is set", () => {
      const configStub = vi.spyOn(ForgeConfig, "getInstance").mockReturnValue({
        getLogLevel: () => LogLevel.WARN,
      } as unknown as ForgeConfig);

      Logger.resetForTest();
      logger = ConsoleLogger.initialize();
      logger.debug("d");
      logger.warn("w");

      expect(consoleSpies.debug).not.toHaveBeenCalled();
      expect(consoleSpies.warn).toHaveBeenCalledWith("w", undefined);

      configStub.mockRestore();
    });
  });
});
