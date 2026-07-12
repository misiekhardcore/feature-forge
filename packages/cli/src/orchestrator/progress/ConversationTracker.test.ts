import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ConversationTracker,
  type ConversationTurn,
  type ToolCallTurn,
} from "./ConversationTracker";

/** Narrowed message variant of {@link ConversationTurn}. */
type MessageTurn = Extract<ConversationTurn, { type: "message" }>;

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
        expect((turns[0] as MessageTurn).role).toBe("unknown");
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
        expect((turns[0] as MessageTurn).role).toBe("unknown");
        expect((turns[0] as MessageTurn).content).toBe("final");
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
        expect((turns[0] as ToolCallTurn).toolStatus).toBe("error");
        expect((turns[0] as ToolCallTurn).toolResult).toBe("command failed");
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
        expect((turns[0] as ToolCallTurn).toolName).toBe("unknown");
        expect((turns[0] as ToolCallTurn).toolResult).toBe("done");
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
        expect((turns[0] as ToolCallTurn).toolResult).toBe("final");
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
      expect((turns[0] as MessageTurn).content).toBe("streaming...");
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
      expect((turns[0] as ToolCallTurn).toolStatus).toBe("running");
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

  describe("serializeToolArgs", () => {
    it("returns the string when args is already a string", () => {
      expect(ConversationTracker.serializeToolArgs("hello")).toBe("hello");
    });

    it("serializes a plain object as formatted JSON", () => {
      const result = ConversationTracker.serializeToolArgs({ command: "ls", cwd: "/tmp" });
      expect(result).toContain('"command"');
      expect(result).toContain("ls");
      expect(result).toContain('"cwd"');
      expect(result).toContain("/tmp");
    });

    it("serializes a number as a string", () => {
      const result = ConversationTracker.serializeToolArgs(42);
      expect(result).toBe("42");
    });

    it("serializes null as string null", () => {
      const result = ConversationTracker.serializeToolArgs(null);
      expect(result).toBe("null");
    });

    it("serializes an array as JSON", () => {
      const result = ConversationTracker.serializeToolArgs(["a", "b"]);
      expect(result).toContain('"a"');
      expect(result).toContain('"b"');
    });

    it("falls back to String() for non-serializable values", () => {
      // BigInt causes JSON.stringify to throw, hitting the catch branch.
      const bigInt = BigInt(123);
      const result = ConversationTracker.serializeToolArgs(bigInt);
      expect(result).toBe("123");
    });
  });

  describe("toolArgs in conversation turns", () => {
    it("captures toolArgs from tool_execution_start events", () => {
      tracker.trackTurn("agent-1", {
        type: "tool_execution_start",
        toolName: "bash",
        args: { command: "ls -la" },
      } as unknown as AgentEvent);
      tracker.trackTurn("agent-1", {
        type: "tool_execution_end",
        toolName: "bash",
        isError: false,
        result: "done",
      } as unknown as AgentEvent);

      const turns = tracker.getConversation("agent-1");
      expect(turns).toHaveLength(1);
      expect((turns[0] as ToolCallTurn).toolArgs).toContain("command");
      expect((turns[0] as ToolCallTurn).toolArgs).toContain("ls -la");
    });

    it("captures string toolArgs verbatim", () => {
      tracker.trackTurn("agent-1", {
        type: "tool_execution_start",
        toolName: "read",
        args: "some-file.txt",
      } as unknown as AgentEvent);
      tracker.trackTurn("agent-1", {
        type: "tool_execution_end",
        toolName: "read",
        isError: false,
        result: "content",
      } as unknown as AgentEvent);

      const turns = tracker.getConversation("agent-1");
      expect((turns[0] as ToolCallTurn).toolArgs).toBe("some-file.txt");
    });

    it("does not set toolArgs when args is undefined", () => {
      tracker.trackTurn("agent-1", {
        type: "tool_execution_start",
        toolName: "bash",
      } as unknown as AgentEvent);
      tracker.trackTurn("agent-1", {
        type: "tool_execution_end",
        toolName: "bash",
        isError: false,
        result: "done",
      } as unknown as AgentEvent);

      const turns = tracker.getConversation("agent-1");
      expect((turns[0] as ToolCallTurn).toolArgs).toBeUndefined();
    });

    it("includes toolArgs in pending tool call", () => {
      tracker.trackTurn("agent-1", {
        type: "tool_execution_start",
        toolName: "bash",
        args: "echo hello",
      } as unknown as AgentEvent);

      const turns = tracker.getConversation("agent-1");
      expect(turns).toHaveLength(1);
      expect((turns[0] as ToolCallTurn).toolArgs).toBe("echo hello");
      expect((turns[0] as ToolCallTurn).toolStatus).toBe("running");
    });
  });

  describe("ingestFromStream", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "forge-ingest-stream-"));
    });

    afterEach(() => {
      try {
        // Clean up is best-effort.
      } catch {
        // ignore
      }
    });

    it("parses formatted stream lines into conversation turns", () => {
      const filePath = join(tmpDir, "agent-1.stream");
      writeFileSync(
        filePath,
        [
          "message_start: assistant",
          "message_end: Hello world",
          "tool_execution_start: read",
          "tool_execution_end: read (ok)",
        ].join("\n"),
        "utf-8",
      );

      tracker.ingestFromStream("agent-1", filePath);

      const turns = tracker.getConversation("agent-1");
      expect(turns).toHaveLength(2);
      expect(turns[0]).toMatchObject({
        type: "message",
        role: "assistant",
        content: "Hello world",
      });
      expect(turns[1]).toMatchObject({
        type: "tool_call",
        toolName: "read",
        toolStatus: "ok",
      });
    });

    it("parses tool_execution_end with error status", () => {
      const filePath = join(tmpDir, "agent-1.stream");
      writeFileSync(
        filePath,
        ["tool_execution_start: bash", "tool_execution_end: bash (error)"].join("\n"),
        "utf-8",
      );

      tracker.ingestFromStream("agent-1", filePath);

      const turns = tracker.getConversation("agent-1");
      expect(turns).toHaveLength(1);
      expect((turns[0] as ToolCallTurn).toolStatus).toBe("error");
    });

    it("parses tool_execution_update lines", () => {
      const filePath = join(tmpDir, "agent-1.stream");
      writeFileSync(
        filePath,
        [
          "tool_execution_start: read",
          "tool_execution_update: read: line 1",
          "tool_execution_update: read: line 2",
          "tool_execution_end: read (ok)",
        ].join("\n"),
        "utf-8",
      );

      tracker.ingestFromStream("agent-1", filePath);

      const turns = tracker.getConversation("agent-1");
      expect(turns).toHaveLength(1);
      expect((turns[0] as ToolCallTurn).toolResult).toContain("line 1");
      expect((turns[0] as ToolCallTurn).toolResult).toContain("line 2");
    });

    it("handles nonexistent file gracefully", () => {
      expect(() => {
        tracker.ingestFromStream("agent-1", "/nonexistent/file.stream");
      }).not.toThrow();

      expect(tracker.getConversation("agent-1")).toEqual([]);
    });

    it("handles empty stream file", () => {
      const filePath = join(tmpDir, "agent-1.stream");
      writeFileSync(filePath, "", "utf-8");

      tracker.ingestFromStream("agent-1", filePath);

      expect(tracker.getConversation("agent-1")).toEqual([]);
    });

    it("parses agent_start and agent_end lines", () => {
      const filePath = join(tmpDir, "agent-1.stream");
      writeFileSync(filePath, ["agent_start: started", "agent_end: completed"].join("\n"), "utf-8");

      tracker.ingestFromStream("agent-1", filePath);

      const turns = tracker.getConversation("agent-1");
      // agent_start/end are not tracked as conversation turns, so should be empty.
      expect(turns).toHaveLength(0);
    });

    it("skips unknown event types gracefully", () => {
      const filePath = join(tmpDir, "agent-1.stream");
      writeFileSync(
        filePath,
        ["message_start: assistant", "unknown_type: something", "message_end: Hello"].join("\n"),
        "utf-8",
      );

      tracker.ingestFromStream("agent-1", filePath);

      const turns = tracker.getConversation("agent-1");
      expect(turns).toHaveLength(1);
      expect((turns[0] as MessageTurn).content).toBe("Hello");
    });

    it("handles tool_execution_end without status suffix", () => {
      const filePath = join(tmpDir, "agent-1.stream");
      writeFileSync(
        filePath,
        ["tool_execution_start: bash", "tool_execution_end: bash"].join("\n"),
        "utf-8",
      );

      tracker.ingestFromStream("agent-1", filePath);

      const turns = tracker.getConversation("agent-1");
      expect(turns).toHaveLength(1);
      expect((turns[0] as ToolCallTurn).toolName).toBe("bash");
      // Without status suffix, isError defaults to false.
      expect((turns[0] as ToolCallTurn).toolStatus).toBe("ok");
    });

    it("handles tool_execution_update without detail after tool name", () => {
      const filePath = join(tmpDir, "agent-1.stream");
      writeFileSync(
        filePath,
        [
          "tool_execution_start: bash",
          "tool_execution_update: bash",
          "tool_execution_end: bash (ok)",
        ].join("\n"),
        "utf-8",
      );

      tracker.ingestFromStream("agent-1", filePath);

      const turns = tracker.getConversation("agent-1");
      expect(turns).toHaveLength(1);
      // The update with empty partialResult should not break conversation tracking.
      expect((turns[0] as ToolCallTurn).toolStatus).toBe("ok");
    });

    it("handles line without colon-space that is not agent_start/agent_end", () => {
      const filePath = join(tmpDir, "agent-1.stream");
      writeFileSync(filePath, ["bare_type"].join("\n"), "utf-8");

      tracker.ingestFromStream("agent-1", filePath);

      const turns = tracker.getConversation("agent-1");
      // Unknown bare type should be skipped.
      expect(turns).toEqual([]);
    });

    it("handles message_update with empty detail", () => {
      const filePath = join(tmpDir, "agent-1.stream");
      writeFileSync(
        filePath,
        ["message_start: assistant", "message_update: ", "message_end: Hello"].join("\n"),
        "utf-8",
      );

      tracker.ingestFromStream("agent-1", filePath);

      const turns = tracker.getConversation("agent-1");
      // The empty message_update should be skipped; Hello from message_end should appear.
      expect(turns).toHaveLength(1);
      expect((turns[0] as MessageTurn).content).toBe("Hello");
    });

    it("handles line that is just 'agent_end' without colon-space", () => {
      const filePath = join(tmpDir, "agent-1.stream");
      writeFileSync(filePath, "agent_end\n", "utf-8");

      tracker.ingestFromStream("agent-1", filePath);

      const turns = tracker.getConversation("agent-1");
      // agent_end is not tracked as a conversation turn.
      expect(turns).toEqual([]);
    });

    it("handles message_start with empty role", () => {
      const filePath = join(tmpDir, "agent-1.stream");
      writeFileSync(filePath, ["message_start: ", "message_end: Hello"].join("\n"), "utf-8");

      tracker.ingestFromStream("agent-1", filePath);

      const turns = tracker.getConversation("agent-1");
      expect(turns).toHaveLength(1);
      expect((turns[0] as MessageTurn).role).toBe("unknown");
      expect((turns[0] as MessageTurn).content).toBe("Hello");
    });

    it("handles message_end with empty detail", () => {
      const filePath = join(tmpDir, "agent-1.stream");
      writeFileSync(filePath, ["message_start: assistant", "message_end: "].join("\n"), "utf-8");

      tracker.ingestFromStream("agent-1", filePath);

      const turns = tracker.getConversation("agent-1");
      // Empty message_end line is skipped, so no content → no turn.
      expect(turns).toEqual([]);
    });

    it("handles tool_execution_start with empty tool name", () => {
      const filePath = join(tmpDir, "agent-1.stream");
      writeFileSync(
        filePath,
        ["tool_execution_start: ", "tool_execution_end: unknown (ok)"].join("\n"),
        "utf-8",
      );

      tracker.ingestFromStream("agent-1", filePath);

      const turns = tracker.getConversation("agent-1");
      expect(turns).toHaveLength(1);
      expect((turns[0] as ToolCallTurn).toolName).toBe("unknown");
    });

    it("parses tool_execution_start with serialized args from stream line", () => {
      const filePath = join(tmpDir, "agent-1.stream");
      writeFileSync(
        filePath,
        [
          'tool_execution_start: read | {"path":"/tmp/file.txt"}',
          "tool_execution_end: read (ok)",
        ].join("\n"),
        "utf-8",
      );

      tracker.ingestFromStream("agent-1", filePath);

      const turns = tracker.getConversation("agent-1");
      expect(turns).toHaveLength(1);
      expect((turns[0] as ToolCallTurn).toolName).toBe("read");
      expect((turns[0] as ToolCallTurn).toolArgs).toContain("path");
      expect((turns[0] as ToolCallTurn).toolArgs).toContain("/tmp/file.txt");
    });

    it("parses tool_execution_start with string args from stream line", () => {
      const filePath = join(tmpDir, "agent-1.stream");
      writeFileSync(
        filePath,
        ["tool_execution_start: read | some-file.txt", "tool_execution_end: read (ok)"].join("\n"),
        "utf-8",
      );

      tracker.ingestFromStream("agent-1", filePath);

      const turns = tracker.getConversation("agent-1");
      expect(turns).toHaveLength(1);
      expect((turns[0] as ToolCallTurn).toolName).toBe("read");
      expect((turns[0] as ToolCallTurn).toolArgs).toBe("some-file.txt");
    });

    it("parses tool_execution_start without args (old format) backward-compatibly", () => {
      const filePath = join(tmpDir, "agent-1.stream");
      writeFileSync(
        filePath,
        ["tool_execution_start: bash", "tool_execution_end: bash (ok)"].join("\n"),
        "utf-8",
      );

      tracker.ingestFromStream("agent-1", filePath);

      const turns = tracker.getConversation("agent-1");
      expect(turns).toHaveLength(1);
      expect((turns[0] as ToolCallTurn).toolName).toBe("bash");
      expect((turns[0] as ToolCallTurn).toolArgs).toBeUndefined();
    });

    it("handles message_update with non-empty detail", () => {
      const filePath = join(tmpDir, "agent-1.stream");
      writeFileSync(
        filePath,
        ["message_start: assistant", "message_update: thinking...", "message_end: Hello"].join(
          "\n",
        ),
        "utf-8",
      );

      tracker.ingestFromStream("agent-1", filePath);

      const turns = tracker.getConversation("agent-1");
      expect(turns).toHaveLength(1);
      expect((turns[0] as MessageTurn).content).toBe("Hello");
    });
  });
});
