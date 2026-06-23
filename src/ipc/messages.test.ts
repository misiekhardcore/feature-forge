import { describe, expect, it } from "vitest";

import { AgentStatus } from "../agents";
import type {
  SendTaskParams,
  SocketMessage,
  SocketPush,
  SocketResponse,
  SpawnAgentParams,
} from "./messages";

describe("SocketMessage type", () => {
  it("shapes a spawn_agent message correctly", () => {
    const params: SpawnAgentParams = {
      role: "researcher",
      systemPrompt: "You are a researcher",
      toolNames: ["read", "grep"],
    };

    const message: SocketMessage = {
      type: "spawn_agent",
      correlationId: "c1",
      params,
    };

    expect(message.type).toBe("spawn_agent");
    expect(message.params.role).toBe("researcher");
  });

  it("shapes a send_task message with await=true", () => {
    const params: SendTaskParams = {
      agentId: "agent-1",
      task: "Research X",
      await: true,
    };

    const message: SocketMessage = {
      type: "send_task",
      correlationId: "c2",
      params,
    };

    expect(message.type).toBe("send_task");
    expect(message.params.await).toBe(true);
  });

  it("shapes a send_task message with await=false", () => {
    const params: SendTaskParams = {
      agentId: "agent-1",
      task: "Fire and forget",
      await: false,
    };

    const message: SocketMessage = {
      type: "send_task",
      correlationId: "c3",
      params,
    };

    expect(message.type).toBe("send_task");
    expect(message.params.await).toBe(false);
  });
});

describe("SocketResponse type", () => {
  it("shapes a successful result response", () => {
    const response: SocketResponse = {
      type: "result",
      correlationId: "c1",
      result: { agentId: "agent-1", role: "researcher" },
    };

    expect(response.type).toBe("result");
    expect(response.correlationId).toBe("c1");
  });

  it("shapes an error response", () => {
    const response: SocketResponse = {
      type: "error",
      correlationId: "c1",
      error: "Agent not found",
    };

    expect(response.type).toBe("error");
    expect(response.error).toBe("Agent not found");
  });
});

describe("SocketPush type", () => {
  it("shapes an agent_update push event", () => {
    const push: SocketPush = {
      type: "agent_update",
      payload: {
        agentId: "agent-1" as never,
        status: AgentStatus.Completed,
        result: "Done",
      },
    };

    expect(push.type).toBe("agent_update");
    expect(push.payload.status).toBe("Completed");
    expect(push.payload.result).toBe("Done");
  });
});
