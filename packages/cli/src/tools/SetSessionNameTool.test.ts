import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";

import { makeMockPi } from "../test-utils";
import { SetSessionNameTool } from "./SetSessionNameTool";

describe("SetSessionNameTool", () => {
  it("has name 'set_session_name'", () => {
    const tool = new SetSessionNameTool(makeMockPi());
    expect(tool.name).toBe("set_session_name");
  });

  it("has a label", () => {
    const tool = new SetSessionNameTool(makeMockPi());
    expect(tool.label).toBe("Set Session Name");
  });

  it("has a description", () => {
    const tool = new SetSessionNameTool(makeMockPi());
    expect(tool.description).toBeTruthy();
  });

  it("runs in the current session (renderShell 'self')", () => {
    const tool = new SetSessionNameTool(makeMockPi());
    expect(tool.renderShell).toBe("self");
  });

  it("defines parameters requiring a non-empty name", () => {
    const tool = new SetSessionNameTool(makeMockPi());
    expect(Value.Check(tool.parameters, { name: "implement #172" })).toBe(true);
    expect(Value.Check(tool.parameters, { name: "" })).toBe(false);
    expect(Value.Check(tool.parameters, {})).toBe(false);
  });

  describe("execute", () => {
    it("sets the session name on the pi instance", async () => {
      const pi = makeMockPi();
      const tool = new SetSessionNameTool(pi);

      await tool.execute("call-1", { name: "my custom name" }, undefined);

      expect(pi.setSessionName).toHaveBeenCalledWith("my custom name");
    });

    it("returns a confirmation message with the new name", async () => {
      const pi = makeMockPi();
      const tool = new SetSessionNameTool(pi);

      const result = await tool.execute("call-1", { name: "my custom name" }, undefined);

      expect(result).toEqual({
        content: [{ type: "text", text: "Session named: my custom name" }],
        details: undefined,
      });
    });

    it("throws AbortError when the signal is already aborted", async () => {
      const pi = makeMockPi();
      const tool = new SetSessionNameTool(pi);
      const controller = new AbortController();
      controller.abort();

      await expect(tool.execute("call-1", { name: "name" }, controller.signal)).rejects.toThrow(
        DOMException,
      );
      expect(pi.setSessionName).not.toHaveBeenCalled();
    });
  });
});
