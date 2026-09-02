import { Box } from "@earendil-works/pi-tui";
import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";

import {
  makeMockPi,
  makeRenderContext,
  makeRenderOptions,
  makeTheme,
  renderLines,
} from "../test-utils";
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

  describe("rendering", () => {
    const tool = new SetSessionNameTool(makeMockPi());
    const theme = makeTheme();

    it("renderCall renders a Box and stores it in the render context state", () => {
      const context = makeRenderContext();
      const component = tool.renderCall({ name: "implement #172" }, theme, context);

      expect(component).toBeInstanceOf(Box);
      expect(context.state._box).toBe(component);
      expect(renderLines(component).join(" ")).toContain("[bg:toolSuccessBg]");
    });

    it("renderCall header contains the session name", () => {
      const lines = renderLines(
        tool.renderCall({ name: "implement #172" }, theme, makeRenderContext()),
      );

      expect(lines.join(" ")).toContain("set_session_name implement #172");
    });

    it("renderResult renders nothing while the result is partial", () => {
      const lines = renderLines(
        tool.renderResult(
          {
            content: [{ type: "text", text: "Session named: implement #172" }],
            details: undefined,
          },
          makeRenderOptions({ isPartial: true }),
          theme,
          makeRenderContext(),
        ),
      );

      expect(lines).toEqual([]);
    });

    it("renderResult renders the confirmation message in the success colour", () => {
      const lines = renderLines(
        tool.renderResult(
          {
            content: [{ type: "text", text: "Session named: implement #172" }],
            details: undefined,
          },
          makeRenderOptions(),
          theme,
          makeRenderContext(),
        ),
      );

      const rendered = lines.join(" ");
      expect(rendered).toContain("Session named: implement #172");
      expect(rendered).toContain("[success]");
    });

    it("renderResult renders an error marker when the context flags an error", () => {
      const lines = renderLines(
        tool.renderResult(
          {
            content: [{ type: "text", text: "set_session_name: rename failed" }],
            details: {},
          },
          makeRenderOptions(),
          theme,
          makeRenderContext({ isError: true }),
        ),
      );

      const rendered = lines.join(" ");
      expect(rendered).toContain("✗ set_session_name: rename failed");
      expect(rendered).toContain("[error]");
    });

    it("renderResult falls back to a muted done marker when content is empty", () => {
      const lines = renderLines(
        tool.renderResult(
          { content: [], details: undefined },
          makeRenderOptions(),
          theme,
          makeRenderContext(),
        ),
      );

      const rendered = lines.join(" ");
      expect(rendered).toContain("✓ done");
    });
  });
});
