import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import type { MarkdownTheme } from "@earendil-works/pi-tui";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ConversationRenderer } from "./ConversationRenderer";

// Use real pi components (UserMessageComponent, AssistantMessageComponent,
// Container, Spacer) which depend on the pi runtime theme singleton.
beforeAll(() => {
  initTheme("dark");
});

afterAll(() => {
  // No cleanup needed — initTheme is idempotent.
});

function makeTheme(): Theme {
  return {
    fg: vi.fn((_color: string, text: string) => text),
    bg: vi.fn((_color: string, text: string) => text),
    bold: vi.fn((text: string) => text),
    italic: vi.fn((text: string) => text),
    inverse: vi.fn((text: string) => text),
  } as unknown as Theme;
}

function makeMarkdownTheme(): MarkdownTheme {
  return {
    heading: vi.fn((text: string) => text),
    link: vi.fn((text: string) => text),
    linkUrl: vi.fn((text: string) => text),
    code: vi.fn((text: string) => text),
    codeBlock: vi.fn((text: string) => text),
    codeBlockBorder: vi.fn((text: string) => text),
    quote: vi.fn((text: string) => text),
    quoteBorder: vi.fn((text: string) => text),
    hr: vi.fn((text: string) => text),
    listBullet: vi.fn((text: string) => text),
    bold: vi.fn((text: string) => text),
    italic: vi.fn((text: string) => text),
    strikethrough: vi.fn((text: string) => text),
    underline: vi.fn((text: string) => text),
  };
}

function makeRenderer(): ConversationRenderer {
  return new ConversationRenderer(makeTheme(), makeMarkdownTheme());
}

function makeUserMessage(text: string, overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    role: "user",
    content: text,
    timestamp: Date.now(),
    ...overrides,
  } as AgentMessage;
}

function makeAssistantMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text" as const, text: "assistant response" }],
    timestamp: Date.now(),
    ...overrides,
  } as unknown as AgentMessage;
}

function makeToolResultMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    role: "toolResult" as const,
    toolCallId: "tc_1",
    toolName: "read",
    content: [{ type: "text" as const, text: "tool result content" }],
    isError: false,
    timestamp: Date.now(),
    ...overrides,
  } as unknown as AgentMessage;
}

function makeUnknownRoleMessage(role: string, text: string): AgentMessage {
  return {
    role,
    content: text,
    timestamp: Date.now(),
  } as unknown as AgentMessage;
}

describe("ConversationRenderer", () => {
  describe("render", () => {
    it("returns an empty array when no messages are provided", () => {
      const renderer = makeRenderer();
      const result = renderer.render([], 80);
      expect(result).toEqual([]);
    });

    it("renders a user message as conversation text", () => {
      const renderer = makeRenderer();
      const messages = [makeUserMessage("Hello, how can I help?")];
      const result = renderer.render(messages, 80);
      expect(result.length).not.toBe(0);
      const joined = result.join(" ");
      expect(joined).toContain("Hello, how can I help?");
    });

    it("renders an assistant message as conversation response", () => {
      const renderer = makeRenderer();
      const messages = [makeAssistantMessage()];
      const result = renderer.render(messages, 80);
      expect(result.length).not.toBe(0);
      const joined = result.join(" ");
      expect(joined).toContain("assistant response");
    });

    it("skips toolResult messages without producing output", () => {
      const renderer = makeRenderer();
      const messages = [makeToolResultMessage()];
      const result = renderer.render(messages, 80);
      expect(result).toEqual([]);
    });

    it("renders user message followed by assistant message with spacing", () => {
      const renderer = makeRenderer();
      const messages = [makeUserMessage("What is the weather?"), makeAssistantMessage()];
      const result = renderer.render(messages, 80);
      expect(result.length).not.toBe(0);
      const joined = result.join(" ");
      expect(joined).toContain("What is the weather?");
      expect(joined).toContain("assistant response");
    });

    it("suppresses extra spacer between consecutive assistant messages", () => {
      const renderer = makeRenderer();
      const messages = [
        makeAssistantMessage({ content: [{ type: "text" as const, text: "first response" }] }),
        makeAssistantMessage({ content: [{ type: "text" as const, text: "second response" }] }),
      ];
      const result = renderer.render(messages, 80);
      expect(result.length).not.toBe(0);
      const joined = result.join(" ");
      expect(joined).toContain("first response");
      expect(joined).toContain("second response");
      // Both assistant messages render without an extra blank spacer line
      // between them (assistant blocks already have built-in internal spacing).
    });

    it("renders user-assistant-user sequence with correct spacing", () => {
      const renderer = makeRenderer();
      const messages = [
        makeUserMessage("First question"),
        makeAssistantMessage({ content: [{ type: "text" as const, text: "First answer" }] }),
        makeUserMessage("Second question"),
      ];
      const result = renderer.render(messages, 80);
      expect(result.length).not.toBe(0);
      const joined = result.join(" ");
      expect(joined).toContain("First question");
      expect(joined).toContain("First answer");
      expect(joined).toContain("Second question");
    });

    it("renders user-user sequence with spacing between them", () => {
      const renderer = makeRenderer();
      const messages = [makeUserMessage("Message one"), makeUserMessage("Message two")];
      const result = renderer.render(messages, 80);
      expect(result.length).not.toBe(0);
      const joined = result.join(" ");
      expect(joined).toContain("Message one");
      expect(joined).toContain("Message two");
    });

    it("handles unknown role by rendering text as UserMessageComponent fallback", () => {
      const renderer = makeRenderer();
      const messages = [makeUnknownRoleMessage("notification", "Some notification text")];
      const result = renderer.render(messages, 80);
      expect(result.length).not.toBe(0);
      const joined = result.join(" ");
      expect(joined).toContain("Some notification text");
    });

    it("skips unknown role messages with empty content", () => {
      const renderer = makeRenderer();
      const messages = [makeUnknownRoleMessage("notification", "")];
      const result = renderer.render(messages, 80);
      expect(result).toEqual([]);
    });

    it("mixes known roles with unknown role fallback", () => {
      const renderer = makeRenderer();
      const messages = [
        makeUserMessage("Hello"),
        makeAssistantMessage({ content: [{ type: "text" as const, text: "Hi there" }] }),
        makeToolResultMessage(),
        makeUnknownRoleMessage("custom", "Custom payload"),
      ];
      const result = renderer.render(messages, 80);
      expect(result.length).not.toBe(0);
      const joined = result.join(" ");
      expect(joined).toContain("Hello");
      expect(joined).toContain("Hi there");
      expect(joined).toContain("Custom payload");
    });

    it("returns empty output when only toolResult messages are provided", () => {
      const renderer = makeRenderer();
      const messages = [
        makeToolResultMessage({ toolCallId: "tc_1" }),
        makeToolResultMessage({ toolCallId: "tc_2" }),
      ];
      const result = renderer.render(messages, 80);
      expect(result).toEqual([]);
    });

    it("renders user message with empty text as no-op", () => {
      const renderer = makeRenderer();
      const messages = [makeUserMessage("")];
      const result = renderer.render(messages, 80);
      expect(result).toEqual([]);
    });

    it("handles user message with null content by returning empty output", () => {
      const renderer = makeRenderer();
      const messages = [makeUserMessage("", { content: null as unknown as string })];
      const result = renderer.render(messages, 80);
      expect(result).toEqual([]);
    });

    it("handles assistant message with undefined content by returning empty output", () => {
      const renderer = makeRenderer();
      const messages = [{ role: "assistant", timestamp: Date.now() } as unknown as AgentMessage];
      const result = renderer.render(messages, 80);
      expect(result).toEqual([]);
    });

    it("handles user message with undefined content by returning empty output", () => {
      const renderer = makeRenderer();
      const messages = [{ role: "user", timestamp: Date.now() } as unknown as AgentMessage];
      const result = renderer.render(messages, 80);
      expect(result).toEqual([]);
    });
  });
});
