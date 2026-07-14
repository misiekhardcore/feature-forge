import { describe, expect, it } from "vitest";

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
