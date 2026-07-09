import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { beforeEach, describe, expect, it } from "vitest";

import { ConversationTracker } from "./ConversationTracker";

describe("ConversationTracker", () => {
  let tracker: ConversationTracker;

  beforeEach(() => {
    tracker = new ConversationTracker();
  });

  describe("trackTurn", () => {
    describe("message events", () => {
      it("tracks a full message lifecycle as a single turn", () => {
        tracker.trackTurn("agent-1", {
          type: "message_start",
          message: { role: "assistant" },
        } as AgentEvent);
        tracker.trackTurn("agent-1", {
          type: "message_update",
          message: { content: [{ type: "text", text: "Hello" }] },
        } as AgentEvent);
        tracker.trackTurn("agent-1", {
          type: "message_end",
          message: { content: [{ type: "text", text: "Hello world" }] },
        } as AgentEvent);

        const turns = tracker.getConversation("agent-1");
        expect(turns).toHaveLength(1);
        expect(turns[0]).toEqual({
          type: "message",
          role: "assistant",
          content: "Hello world",
        });
      });

      it("tracks multiple messages for the same agent", () => {
        tracker.trackTurn("agent-1", {
          type: "message_start",
          message: { role: "assistant" },
        } as AgentEvent);
        tracker.trackTurn("agent-1", {
          type: "message_end",
          message: { content: "first message" },
        } as AgentEvent);

        tracker.trackTurn("agent-1", {
          type: "message_start",
          message: { role: "user" },
        } as AgentEvent);
        tracker.trackTurn("agent-1", {
          type: "message_end",
          message: { content: "second message" },
        } as AgentEvent);

        const turns = tracker.getConversation("agent-1");
        expect(turns).toHaveLength(2);
        expect(turns[0]).toEqual({
          type: "message",
          role: "assistant",
          content: "first message",
        });
        expect(turns[1]).toEqual({
          type: "message",
          role: "user",
          content: "second message",
        });
      });

      it("resolves role to unknown when message has no role field", () => {
        tracker.trackTurn("agent-1", {
          type: "message_start",
          message: {},
        } as AgentEvent);
        tracker.trackTurn("agent-1", {
          type: "message_end",
          message: { content: "text" },
        } as AgentEvent);

        const turns = tracker.getConversation("agent-1");
        expect(turns[0].role).toBe("unknown");
      });

      it("resolves role to unknown when message is not an object", () => {
        tracker.trackTurn("agent-1", {
          type: "message_start",
          message: "plain string",
        } as unknown as AgentEvent);
        tracker.trackTurn("agent-1", {
          type: "message_end",
          message: "final",
        } as unknown as AgentEvent);

        const turns = tracker.getConversation("agent-1");
        expect(turns).toHaveLength(1);
        expect(turns[0].role).toBe("unknown");
        expect(turns[0].content).toBe("final");
      });
    });

    describe("tool call events", () => {
      it("tracks a full tool call lifecycle as a single turn", () => {
        tracker.trackTurn("agent-1", {
          type: "tool_execution_start",
          toolName: "bash",
        } as AgentEvent);
        tracker.trackTurn("agent-1", {
          type: "tool_execution_update",
          toolName: "bash",
          partialResult: "line 1\n",
        } as AgentEvent);
        tracker.trackTurn("agent-1", {
          type: "tool_execution_update",
          toolName: "bash",
          partialResult: "line 2\n",
        } as AgentEvent);
        tracker.trackTurn("agent-1", {
          type: "tool_execution_end",
          toolName: "bash",
          isError: false,
          result: "line 1\nline 2\n",
        } as AgentEvent);

        const turns = tracker.getConversation("agent-1");
        expect(turns).toHaveLength(1);
        expect(turns[0]).toEqual({
          type: "tool_call",
          toolName: "bash",
          toolStatus: "ok",
          toolResult: "line 1\nline 2\n",
        });
      });

      it("tracks a tool call that errored", () => {
        tracker.trackTurn("agent-1", {
          type: "tool_execution_start",
          toolName: "bash",
        } as AgentEvent);
        tracker.trackTurn("agent-1", {
          type: "tool_execution_end",
          toolName: "bash",
          isError: true,
          result: "command failed",
        } as AgentEvent);

        const turns = tracker.getConversation("agent-1");
        expect(turns[0].toolStatus).toBe("error");
        expect(turns[0].toolResult).toBe("command failed");
      });

      it("uses unknown toolName when toolName is not provided", () => {
        tracker.trackTurn("agent-1", {
          type: "tool_execution_start",
        } as AgentEvent);
        tracker.trackTurn("agent-1", {
          type: "tool_execution_end",
          isError: false,
          result: "done",
        } as AgentEvent);

        const turns = tracker.getConversation("agent-1");
        expect(turns[0].toolName).toBe("unknown");
        expect(turns[0].toolResult).toBe("done");
      });

      it("ignores partialResult updates that are not strings", () => {
        tracker.trackTurn("agent-1", {
          type: "tool_execution_start",
          toolName: "bash",
        } as AgentEvent);
        tracker.trackTurn("agent-1", {
          type: "tool_execution_update",
          toolName: "bash",
          partialResult: 123,
        } as AgentEvent);
        tracker.trackTurn("agent-1", {
          type: "tool_execution_end",
          toolName: "bash",
          isError: false,
          result: "final",
        } as AgentEvent);

        const turns = tracker.getConversation("agent-1");
        expect(turns[0].toolResult).toBe("final");
      });
    });

    describe("event sequencing", () => {
      it("finalizes pending message before starting a tool call", () => {
        tracker.trackTurn("agent-1", {
          type: "message_start",
          message: { role: "assistant" },
        } as AgentEvent);
        tracker.trackTurn("agent-1", {
          type: "message_end",
          message: { content: "Let me run this" },
        } as AgentEvent);
        tracker.trackTurn("agent-1", {
          type: "tool_execution_start",
          toolName: "bash",
        } as AgentEvent);
        tracker.trackTurn("agent-1", {
          type: "tool_execution_end",
          toolName: "bash",
          isError: false,
          result: "done",
        } as AgentEvent);

        const turns = tracker.getConversation("agent-1");
        expect(turns).toHaveLength(2);
        expect(turns[0].type).toBe("message");
        expect(turns[1].type).toBe("tool_call");
      });

      it("finalizes pending tool call before starting next message", () => {
        tracker.trackTurn("agent-1", {
          type: "tool_execution_start",
          toolName: "read",
        } as AgentEvent);
        tracker.trackTurn("agent-1", {
          type: "tool_execution_end",
          toolName: "read",
          isError: false,
          result: "file contents",
        } as AgentEvent);
        tracker.trackTurn("agent-1", {
          type: "message_start",
          message: { role: "assistant" },
        } as AgentEvent);
        tracker.trackTurn("agent-1", {
          type: "message_end",
          message: { content: "I read the file" },
        } as AgentEvent);

        const turns = tracker.getConversation("agent-1");
        expect(turns).toHaveLength(2);
        expect(turns[0].type).toBe("tool_call");
        expect(turns[1].type).toBe("message");
      });
    });
  });

  describe("getConversation", () => {
    it("returns empty array for unknown agent", () => {
      expect(tracker.getConversation("unknown")).toEqual([]);
    });

    it("includes in-progress message with content", () => {
      tracker.trackTurn("agent-1", {
        type: "message_start",
        message: { role: "assistant" },
      } as AgentEvent);
      tracker.trackTurn("agent-1", {
        type: "message_update",
        message: { content: [{ type: "text", text: "streaming..." }] },
      } as AgentEvent);

      const turns = tracker.getConversation("agent-1");
      expect(turns).toHaveLength(1);
      expect(turns[0].type).toBe("message");
      expect(turns[0].content).toBe("streaming...");
    });

    it("excludes in-progress message with empty content", () => {
      tracker.trackTurn("agent-1", {
        type: "message_start",
        message: { role: "assistant" },
      } as AgentEvent);

      const turns = tracker.getConversation("agent-1");
      expect(turns).toHaveLength(0);
    });

    it("includes in-progress tool call with running status", () => {
      tracker.trackTurn("agent-1", {
        type: "tool_execution_start",
        toolName: "bash",
      } as AgentEvent);

      const turns = tracker.getConversation("agent-1");
      expect(turns).toHaveLength(1);
      expect(turns[0].type).toBe("tool_call");
      expect(turns[0].toolStatus).toBe("running");
    });

    it("tracks multiple agents independently", () => {
      tracker.trackTurn("agent-1", {
        type: "message_start",
        message: { role: "assistant" },
      } as AgentEvent);
      tracker.trackTurn("agent-1", {
        type: "message_end",
        message: { content: "from agent 1" },
      } as AgentEvent);

      tracker.trackTurn("agent-2", {
        type: "tool_execution_start",
        toolName: "read",
      } as AgentEvent);
      tracker.trackTurn("agent-2", {
        type: "tool_execution_end",
        toolName: "read",
        isError: false,
        result: "agent 2 result",
      } as AgentEvent);

      expect(tracker.getConversation("agent-1")).toHaveLength(1);
      expect(tracker.getConversation("agent-2")).toHaveLength(1);
      expect(tracker.getConversation("agent-1")[0].type).toBe("message");
      expect(tracker.getConversation("agent-2")[0].type).toBe("tool_call");
    });
  });

  describe("clear", () => {
    it("removes all tracked conversations and pending state", () => {
      tracker.trackTurn("agent-1", {
        type: "message_start",
        message: { role: "assistant" },
      } as AgentEvent);
      tracker.trackTurn("agent-1", {
        type: "message_end",
        message: { content: "hello" },
      } as AgentEvent);

      tracker.trackTurn("agent-2", {
        type: "tool_execution_start",
        toolName: "bash",
      } as AgentEvent);

      tracker.clear();

      expect(tracker.getConversation("agent-1")).toEqual([]);
      expect(tracker.getConversation("agent-2")).toEqual([]);
    });

    it("clears pending message state", () => {
      tracker.trackTurn("agent-1", {
        type: "message_start",
        message: { role: "assistant" },
      } as AgentEvent);

      tracker.clear();

      expect(tracker.getConversation("agent-1")).toEqual([]);
    });
  });
});
