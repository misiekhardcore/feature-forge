import { describe, expect, it } from "vitest";

import { MessageDeltaAssembler, type WireAssistantDelta } from "./MessageDeltaAssembler";

describe("MessageDeltaAssembler", () => {
  it("accumulates text deltas into a partial message", () => {
    const assembler = new MessageDeltaAssembler();
    assembler.apply({ type: "start" });

    assembler.apply({ type: "text_delta", contentIndex: 0, delta: "Hello " });
    const partial = assembler.apply({ type: "text_delta", contentIndex: 0, delta: "world" });

    expect(partial).toBeDefined();
    const content = partial!.content as Array<{ type: string; text: string }>;
    expect(content).toEqual([{ type: "text", text: "Hello world" }]);
  });

  it("returns undefined for deltas that do not change the message", () => {
    const assembler = new MessageDeltaAssembler();
    expect(assembler.apply({ type: "start" })).toBeUndefined();
  });

  it("takes text_end content verbatim", () => {
    const assembler = new MessageDeltaAssembler();
    assembler.apply({ type: "text_delta", contentIndex: 0, delta: "partial" });
    const partial = assembler.apply({ type: "text_end", contentIndex: 0, content: "final" });

    const content = partial!.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toBe("final");
  });

  it("accumulates thinking deltas into thinking blocks", () => {
    const assembler = new MessageDeltaAssembler();
    assembler.apply({ type: "thinking_delta", contentIndex: 0, delta: "reasoning" });
    const partial = assembler.apply({ type: "thinking_delta", contentIndex: 0, delta: "..." });

    const content = partial!.content as Array<{ type: string; thinking: string }>;
    expect(content).toEqual([{ type: "thinking", thinking: "reasoning..." }]);
  });

  it("handles text_start and thinking_end deltas", () => {
    const assembler = new MessageDeltaAssembler();
    assembler.apply({ type: "text_start", contentIndex: 0 });
    assembler.apply({ type: "thinking_start", contentIndex: 1 });
    const partial = assembler.apply({
      type: "thinking_end",
      contentIndex: 1,
      content: "done reasoning",
    });

    const content = partial!.content as Array<{ type: string; text?: string; thinking?: string }>;
    expect(content).toEqual([
      { type: "text", text: "" },
      { type: "thinking", thinking: "done reasoning" },
    ]);
  });

  it("accumulates raw tool-call argument fragments before toolcall_end", () => {
    const assembler = new MessageDeltaAssembler();
    assembler.apply({ type: "toolcall_start", contentIndex: 0, id: "call-1", toolName: "bash" });
    const partial = assembler.apply({ type: "toolcall_delta", contentIndex: 0, delta: '{"cmd":"' });

    const content = partial!.content as Array<{ type: string; id: string; name: string }>;
    expect(content[0]).toMatchObject({ type: "toolCall", id: "call-1", name: "bash" });
  });

  it("tracks tool call starts and ends", () => {
    const assembler = new MessageDeltaAssembler();
    assembler.apply({ type: "toolcall_start", contentIndex: 0, id: "call-1", toolName: "read" });
    const partial = assembler.apply({
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: { type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.ts" } },
    });

    const content = partial!.content as Array<{ type: string; id: string; name: string }>;
    expect(content[0]).toMatchObject({ type: "toolCall", id: "call-1", name: "read" });
  });

  it("keeps blocks in contentIndex order", () => {
    const assembler = new MessageDeltaAssembler();
    assembler.apply({ type: "toolcall_start", contentIndex: 1, id: "c", toolName: "bash" });
    const partial = assembler.apply({ type: "text_delta", contentIndex: 0, delta: "first" });

    const content = partial!.content as Array<{ type: string; text?: string; id?: string }>;
    expect(content.map((b) => b.type)).toEqual(["text", "toolCall"]);
  });

  it("returns the final message on done and resets", () => {
    const assembler = new MessageDeltaAssembler();
    assembler.apply({ type: "text_delta", contentIndex: 0, delta: "stale" });

    const done = {
      type: "done" as const,
      reason: "stop" as const,
      message: { role: "assistant" as const, content: [], timestamp: 1 },
    } as unknown as WireAssistantDelta;
    const partial = assembler.apply(done);
    expect(partial).toBe((done as unknown as { message: unknown }).message);

    // Reset after done: next deltas start from an empty message.
    expect(assembler.apply({ type: "text_delta", contentIndex: 0, delta: "x" })!.content).toEqual([
      { type: "text", text: "x" },
    ]);
  });

  it("returns the error message on error and resets", () => {
    const assembler = new MessageDeltaAssembler();
    const error = {
      type: "error" as const,
      reason: "error" as const,
      error: { role: "assistant" as const, content: [], timestamp: 1 },
    } as unknown as WireAssistantDelta;
    expect(assembler.apply(error)).toBe((error as unknown as { error: unknown }).error);
  });
});
