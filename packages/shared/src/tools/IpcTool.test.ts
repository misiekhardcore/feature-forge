import type { TSchema } from "typebox";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { type IpcRequestClient, IpcTool, NO_CLIENT_ERROR } from "./IpcTool";

class TestIpcTool extends IpcTool<TSchema, { status: string }> {
  readonly name = "test_ipc";
  readonly label = "Test IPC";
  readonly description = "Proxies a request over IPC";
  readonly parameters = {} as TSchema;
  protected readonly messageType = "test_message";
}

class ExposedIpcTool extends TestIpcTool {
  runIpc(params: unknown, timeout?: number, signal?: AbortSignal) {
    return this.ipc(params, timeout, signal);
  }
}

type RequestMock = Mock<
  (type: string, params: unknown, timeout?: number, signal?: AbortSignal) => Promise<unknown>
>;

describe("IpcTool", () => {
  it("keeps NO_CLIENT_ERROR frozen as a readonly literal", () => {
    expectTypeOf(NO_CLIENT_ERROR).toEqualTypeOf<{
      readonly error: "Not available in orchestrator mode";
    }>();
  });

  it("exposes the tool identity members", () => {
    const tool = new TestIpcTool(null);
    expect(tool.name).toBe("test_ipc");
    expect(tool.label).toBe("Test IPC");
    expect(tool.description).toBeTruthy();
    expect(tool.parameters).toBeDefined();
  });

  describe("without client", () => {
    it("returns the not-available error", async () => {
      const tool = new TestIpcTool(null);
      const result = await tool.execute("call-1", {}, undefined);
      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify(NO_CLIENT_ERROR) }],
        details: NO_CLIENT_ERROR,
      });
    });

    it("throws AbortError when the signal is already aborted", async () => {
      const tool = new TestIpcTool(null);
      const controller = new AbortController();
      controller.abort();
      await expect(tool.execute("call-1", {}, controller.signal)).rejects.toThrow(DOMException);
    });
  });

  describe("with client", () => {
    let request: RequestMock;
    let client: IpcRequestClient;
    let tool: TestIpcTool;

    beforeEach(() => {
      request = vi.fn().mockResolvedValue({ status: "ok" });
      client = { request };
      tool = new TestIpcTool(client);
    });

    it("sends a request with the message type and returns the result", async () => {
      const result = await tool.execute("call-1", { agentId: "agent-1" }, undefined);
      expect(request).toHaveBeenCalledWith(
        "test_message",
        { agentId: "agent-1" },
        undefined,
        undefined,
      );
      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify({ status: "ok" }, null, 2) }],
        details: { status: "ok" },
      });
    });

    it("wraps Error rejections in the shared error-details shape", async () => {
      request.mockRejectedValue(new Error("Connection lost"));
      const result = await tool.execute("call-1", {}, undefined);
      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify({ error: "Connection lost" }) }],
        details: { error: "Connection lost" },
      });
    });

    it("wraps non-Error rejections in the shared error-details shape", async () => {
      request.mockRejectedValue("string error");
      const result = await tool.execute("call-1", {}, undefined);
      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify({ error: "string error" }) }],
        details: { error: "string error" },
      });
    });

    it("throws AbortError before dispatching when the signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(tool.execute("call-1", {}, controller.signal)).rejects.toThrow(DOMException);
      expect(request).not.toHaveBeenCalled();
    });

    it("threads an explicit timeout through to the client request", async () => {
      const toolWithTimeout = new ExposedIpcTool(client);
      await toolWithTimeout.runIpc({}, 5_000);
      expect(request).toHaveBeenCalledWith("test_message", {}, 5_000, undefined);
    });

    it("threads the signal through to the client request", async () => {
      const toolWithTimeout = new ExposedIpcTool(client);
      const controller = new AbortController();
      await toolWithTimeout.runIpc({}, undefined, controller.signal);
      expect(request).toHaveBeenCalledWith("test_message", {}, undefined, controller.signal);
    });
  });
});
