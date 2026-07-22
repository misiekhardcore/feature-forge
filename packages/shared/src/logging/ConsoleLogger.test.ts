import { describe, expect, it } from "vitest";

import { ConsoleLogger } from "./ConsoleLogger";

describe("ConsoleLogger", () => {
  describe("log methods", () => {
    it("returns void without throwing for error", () => {
      const logger = ConsoleLogger.initialize();
      expect(() => logger.error("test")).not.toThrow();
      expect(logger.error("test")).toBeUndefined();
    });

    it("returns void without throwing for warn", () => {
      const logger = ConsoleLogger.initialize();
      expect(() => logger.warn("test")).not.toThrow();
      expect(logger.warn("test")).toBeUndefined();
    });

    it("returns void without throwing for info", () => {
      const logger = ConsoleLogger.initialize();
      expect(() => logger.info("test")).not.toThrow();
      expect(logger.info("test")).toBeUndefined();
    });

    it("returns void without throwing for debug", () => {
      const logger = ConsoleLogger.initialize();
      expect(() => logger.debug("test")).not.toThrow();
      expect(logger.debug("test")).toBeUndefined();
    });

    it("accepts optional data parameter without side effects", () => {
      const logger = ConsoleLogger.initialize();
      expect(() => logger.error("msg", { key: "value", nested: { deep: true } })).not.toThrow();
      expect(() => logger.warn("msg", { array: [1, 2, 3] })).not.toThrow();
      expect(() => logger.info("msg", undefined)).not.toThrow();
    });

    it("has zero observable side effects", () => {
      const before = { ...process.env };
      const logger = ConsoleLogger.initialize();
      logger.error("should not appear anywhere");
      logger.info("still nothing");
      expect(process.env).toEqual(before);
    });
  });
});
