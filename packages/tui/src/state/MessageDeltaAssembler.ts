import type { AssistantMessage, ToolCall } from "@earendil-works/pi-ai";

/** One assistant-message delta as emitted on the RPC/JSON wire (pi >= 0.84). */
export type WireAssistantDelta =
  | { type: "start" }
  | { type: "text_start"; contentIndex: number }
  | { type: "text_delta"; contentIndex: number; delta: string }
  | { type: "text_end"; contentIndex: number; content: string }
  | { type: "thinking_start"; contentIndex: number }
  | { type: "thinking_delta"; contentIndex: number; delta: string }
  | { type: "thinking_end"; contentIndex: number; content: string }
  | { type: "toolcall_start"; contentIndex: number; id: string; toolName: string }
  | { type: "toolcall_delta"; contentIndex: number; delta: string }
  | { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall }
  | { type: "done"; reason: string; message: AssistantMessage }
  | { type: "error"; reason: string; error: AssistantMessage };

/** Per-content-index accumulation state for one in-flight assistant message. */
interface DeltaBlock {
  kind: "text" | "thinking" | "toolCall";
  text: string;
  toolCall?: ToolCall;
}

/**
 * Reassembles a displayable partial assistant message from `message_update`
 * deltas. The result is display-only and is replaced by the authoritative
 * `message_end` message.
 */
export class MessageDeltaAssembler {
  private readonly blocks = new Map<number, DeltaBlock>();

  reset(): void {
    this.blocks.clear();
  }

  apply(delta: WireAssistantDelta): AssistantMessage | undefined {
    switch (delta.type) {
      case "start":
        this.reset();
        return undefined;
      case "done":
        this.reset();
        return delta.message;
      case "error":
        this.reset();
        return delta.error;
      case "text_start":
      case "text_delta":
      case "text_end": {
        const block = this.block(delta.contentIndex, "text");
        if (delta.type === "text_delta") block.text += delta.delta;
        else if (delta.type === "text_end") block.text = delta.content;
        return this.snapshot();
      }
      case "thinking_start":
      case "thinking_delta":
      case "thinking_end": {
        const block = this.block(delta.contentIndex, "thinking");
        if (delta.type === "thinking_delta") block.text += delta.delta;
        else if (delta.type === "thinking_end") block.text = delta.content;
        return this.snapshot();
      }
      case "toolcall_start": {
        const block = this.block(delta.contentIndex, "toolCall");
        block.toolCall = { type: "toolCall", id: delta.id, name: delta.toolName, arguments: {} };
        return this.snapshot();
      }
      case "toolcall_delta": {
        // Arguments stream as raw JSON fragments; the complete object only
        // arrives on toolcall_end.
        const block = this.block(delta.contentIndex, "toolCall");
        block.text += delta.delta;
        return this.snapshot();
      }
      case "toolcall_end": {
        const block = this.block(delta.contentIndex, "toolCall");
        block.toolCall = delta.toolCall;
        block.text = "";
        return this.snapshot();
      }
    }
  }

  private block(contentIndex: number, kind: DeltaBlock["kind"]): DeltaBlock {
    const existing = this.blocks.get(contentIndex);
    if (existing && existing.kind === kind) return existing;
    const created: DeltaBlock = { kind, text: "" };
    this.blocks.set(contentIndex, created);
    return created;
  }

  private snapshot(): AssistantMessage {
    const content = [...this.blocks.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, block]) => {
        if (block.kind === "text") return { type: "text" as const, text: block.text };
        if (block.kind === "thinking") return { type: "thinking" as const, thinking: block.text };
        return block.toolCall ?? { type: "toolCall" as const, id: "", name: "", arguments: {} };
      });
    return {
      role: "assistant",
      content,
      api: "unknown",
      provider: "unknown",
      model: "unknown",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    };
  }
}
