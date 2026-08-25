import { makeMockPi } from "@feature-forge/core/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AgentStatus } from "../agents";
import { connectChildClient } from "./connectChildClient";
import type { SocketPush } from "./messages";

const hoisted = vi.hoisted(() => {
  const instance = {
    connect: vi.fn().mockResolvedValue(undefined),
    onPush: vi.fn(),
  };
  return { instance };
});

vi.mock("./ChildSocketClient", () => ({
  ChildSocketClient: vi.fn(function (this: unknown, socketPath: string) {
    // Regular function so `new` still works (vi.fn + arrow implementation
    // would hand the arrow itself to `new`, which is not a constructor).
    (hoisted.instance as { socketPath?: string }).socketPath = socketPath;
    return hoisted.instance;
  }),
}));

describe("connectChildClient", () => {
  // The shared hoisted.instance mock accumulates call counts across tests;
  // clear between tests so toHaveBeenCalledTimes assertions are order-independent.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("connects to the given socket path and returns the client", async () => {
    const pi = makeMockPi();
    const client = await connectChildClient("/tmp/forge-parent.sock", pi);

    expect(hoisted.instance.connect).toHaveBeenCalledTimes(1);
    expect(client).toBe(hoisted.instance);
  });

  it("forwards agent_update pushes as display messages with the payload", async () => {
    const pi = makeMockPi();
    await connectChildClient("/tmp/forge-parent.sock", pi);

    const pushHandler = hoisted.instance.onPush.mock.calls.at(-1)![0] as (
      event: SocketPush,
    ) => void;
    const push: SocketPush = {
      type: "agent_update",
      payload: {
        agentId: "agent-1",
        status: AgentStatus.Completed,
        result: "all green",
      },
    };
    pushHandler(push);

    expect(pi.sendMessage).toHaveBeenCalledWith({
      customType: "agent_update",
      content: [
        {
          type: "text",
          text: "**Agent agent-1** — Completed:\n\nall green",
        },
      ],
      display: true,
      details: push.payload,
    });
  });

  it("forwards agent_update pushes without a result field", async () => {
    const pi = makeMockPi();
    await connectChildClient("/tmp/forge-parent.sock", pi);

    const pushHandler = hoisted.instance.onPush.mock.calls.at(-1)![0] as (
      event: SocketPush,
    ) => void;
    const push: SocketPush = {
      type: "agent_update",
      payload: { agentId: "agent-2", status: AgentStatus.Running },
    };
    pushHandler(push);

    expect(pi.sendMessage).toHaveBeenCalledWith({
      customType: "agent_update",
      content: [{ type: "text", text: "**Agent agent-2** — Running" }],
      display: true,
      details: push.payload,
    });
  });

  it("ignores non-agent_update pushes", async () => {
    const pi = makeMockPi();
    await connectChildClient("/tmp/forge-parent.sock", pi);

    const pushHandler = hoisted.instance.onPush.mock.calls.at(-1)![0] as (
      event: SocketPush,
    ) => void;
    pushHandler({ type: "something_else", payload: {} } as unknown as SocketPush);

    expect(pi.sendMessage).not.toHaveBeenCalled();
  });
});
