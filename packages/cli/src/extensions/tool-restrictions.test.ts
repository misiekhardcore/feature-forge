import { describe, expect, it } from "vitest";

import { makeMockPiWithHandlers } from "../test-utils";
import { activateToolRestrictions } from "./tool-restrictions";

const PROJECT_ROOT = "/home/user/proj";

function makeToolCallEvent(toolName: string, input: Record<string, unknown> | null) {
  return {
    type: "tool_call" as const,
    toolCallId: "call-1",
    toolName,
    input,
  };
}

describe("activateToolRestrictions", () => {
  it("registers a tool_call handler on the pi instance", () => {
    const pi = makeMockPiWithHandlers();
    activateToolRestrictions(pi, { bash: ["allowed-*"] }, PROJECT_ROOT);

    expect(pi.on).toHaveBeenCalledWith("tool_call", expect.any(Function));
  });

  it("does nothing when restrictions map is empty", () => {
    const pi = makeMockPiWithHandlers();
    activateToolRestrictions(pi, {}, PROJECT_ROOT);

    expect(pi.on).not.toHaveBeenCalled();
  });

  describe("bash restrictions", () => {
    it("allows bash commands that match a glob pattern", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { bash: ["allowed-*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;
      const result = handler(makeToolCallEvent("bash", { command: "allowed-command" }));

      expect(result).toBeUndefined();
    });

    it("blocks bash commands that do not match any pattern", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { bash: ["allowed-*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;
      const result = handler(makeToolCallEvent("bash", { command: "blocked-command" }));

      expect(result).toEqual({
        block: true,
        reason: expect.stringContaining("blocked-command"),
      });
    });

    it("allows commands matching any of multiple patterns", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { bash: ["build:*", "test:*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;

      expect(handler(makeToolCallEvent("bash", { command: "build:compile" }))).toBeUndefined();
      expect(handler(makeToolCallEvent("bash", { command: "test:unit" }))).toBeUndefined();
      expect(handler(makeToolCallEvent("bash", { command: "deploy:prod" }))).toEqual({
        block: true,
        reason: expect.stringContaining("deploy:prod"),
      });
    });

    it("blocks bash tool calls with missing command in input", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { bash: ["allowed-*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;
      const result = handler(makeToolCallEvent("bash", {}));

      expect(result).toEqual({
        block: true,
        reason: 'bash tool call missing "command" in input',
      });
    });

    it("blocks bash tool calls with null input", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { bash: ["allowed-*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;
      const result = handler(makeToolCallEvent("bash", null));

      expect(result).toEqual({
        block: true,
        reason: 'bash tool call missing "command" in input',
      });
    });

    it("blocks bash tool calls with a non-string command value", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { bash: ["allowed-*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;
      const result = handler(makeToolCallEvent("bash", { command: 42 }));

      expect(result).toEqual({
        block: true,
        reason: 'bash tool call with non-string "command"',
      });
    });

    it("supports negation patterns", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(
        pi,
        {
          bash: ["git *", "!git push --force"],
        },
        PROJECT_ROOT,
      );

      const handler = pi.getHandler("tool_call")!;

      expect(handler(makeToolCallEvent("bash", { command: "git status" }))).toBeUndefined();
      expect(handler(makeToolCallEvent("bash", { command: "git push --force" }))).toEqual({
        block: true,
        reason: expect.stringContaining("git push --force"),
      });
    });

    it("does not resolve bash patterns against projectRoot", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { bash: ["git *"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;
      expect(handler(makeToolCallEvent("bash", { command: "git status" }))).toBeUndefined();
      expect(handler(makeToolCallEvent("bash", { command: "rm -rf /" }))).toEqual({
        block: true,
        reason: expect.stringContaining("rm -rf /"),
      });
    });
  });

  describe("write restrictions", () => {
    it("restricts write tool calls by path pattern", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { write: ["src/*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;

      expect(
        handler(makeToolCallEvent("write", { path: "/home/user/proj/src/file.ts" })),
      ).toBeUndefined();
      expect(handler(makeToolCallEvent("write", { path: "/home/user/proj/docs/file.md" }))).toEqual(
        {
          block: true,
          reason: expect.stringContaining("docs/file.md"),
        },
      );
    });

    it("blocks write calls with missing path field", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { write: ["*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;
      const result = handler(makeToolCallEvent("write", { content: "hello" }));

      expect(result).toEqual({
        block: true,
        reason: 'write tool call missing "path" in input',
      });
    });

    describe("absolute path matching", () => {
      it("allows write when pattern is directory-scoped and value is absolute", () => {
        const pi = makeMockPiWithHandlers();
        activateToolRestrictions(pi, { write: [".forge/worktrees/**/NOTES.md"] }, PROJECT_ROOT);
        const handler = pi.getHandler("tool_call")!;
        expect(
          handler(
            makeToolCallEvent("write", {
              path: "/home/user/proj/.forge/worktrees/ws-abc/NOTES.md",
            }),
          ),
        ).toBeUndefined();
      });

      it("blocks write when absolute path does not match the glob", () => {
        const pi = makeMockPiWithHandlers();
        activateToolRestrictions(pi, { write: [".forge/worktrees/**/NOTES.md"] }, PROJECT_ROOT);
        const handler = pi.getHandler("tool_call")!;
        expect(
          handler(
            makeToolCallEvent("write", {
              path: "/home/user/proj/src/secrets.ts",
            }),
          ),
        ).toEqual({
          block: true,
          reason: expect.stringContaining("secrets.ts"),
        });
      });

      it("negation blocks absolute path that matches the negated glob", () => {
        const pi = makeMockPiWithHandlers();
        activateToolRestrictions(
          pi,
          {
            write: [".forge/worktrees/**/NOTES.md", "!.forge/worktrees/**/BAD-NOTES.md"],
          },
          PROJECT_ROOT,
        );
        const handler = pi.getHandler("tool_call")!;
        expect(
          handler(
            makeToolCallEvent("write", {
              path: "/home/user/proj/.forge/worktrees/ws-abc/BAD-NOTES.md",
            }),
          ),
        ).toEqual({
          block: true,
          reason: expect.stringContaining("BAD-NOTES.md"),
        });
      });
    });
  });

  describe("grep restrictions", () => {
    it("restricts grep tool calls by path field", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { grep: ["src/*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;

      expect(
        handler(makeToolCallEvent("grep", { path: "/home/user/proj/src/main.ts" })),
      ).toBeUndefined();
      expect(
        handler(makeToolCallEvent("grep", { path: "/home/user/proj/docs/readme.md" })),
      ).toEqual({
        block: true,
        reason: expect.stringContaining("docs/readme.md"),
      });
    });

    it("blocks grep calls with missing path field", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { grep: ["*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;
      const result = handler(makeToolCallEvent("grep", { pattern: "search" }));

      expect(result).toEqual({
        block: true,
        reason: 'grep tool call missing "path" in input',
      });
    });

    it("blocks grep call without explicit path — intentional: search without path restriction would bypass restriction", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { grep: ["src/*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;
      const result = handler(makeToolCallEvent("grep", { pattern: "search", glob: "*.ts" }));

      expect(result).toEqual({
        block: true,
        reason: 'grep tool call missing "path" in input',
      });
    });
  });

  describe("read restrictions", () => {
    it("restricts read tool calls by path pattern", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { read: ["src/*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;

      expect(
        handler(makeToolCallEvent("read", { path: "/home/user/proj/src/file.ts" })),
      ).toBeUndefined();
      expect(handler(makeToolCallEvent("read", { path: "/home/user/proj/docs/file.md" }))).toEqual({
        block: true,
        reason: expect.stringContaining("docs/file.md"),
      });
    });

    it("blocks read calls with missing path field", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { read: ["*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;
      const result = handler(makeToolCallEvent("read", { content: "hello" }));

      expect(result).toEqual({
        block: true,
        reason: 'read tool call missing "path" in input',
      });
    });

    it("blocks read calls with non-string path", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { read: ["*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;
      const result = handler(makeToolCallEvent("read", { path: 42 }));

      expect(result).toEqual({
        block: true,
        reason: 'read tool call with non-string "path"',
      });
    });
  });

  describe("edit restrictions", () => {
    it("restricts edit tool calls by path pattern", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { edit: ["src/*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;

      expect(
        handler(makeToolCallEvent("edit", { path: "/home/user/proj/src/file.ts" })),
      ).toBeUndefined();
      expect(handler(makeToolCallEvent("edit", { path: "/home/user/proj/docs/file.md" }))).toEqual({
        block: true,
        reason: expect.stringContaining("docs/file.md"),
      });
    });

    it("blocks edit calls with missing path field", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { edit: ["*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;
      const result = handler(makeToolCallEvent("edit", { content: "hello" }));

      expect(result).toEqual({
        block: true,
        reason: 'edit tool call missing "path" in input',
      });
    });

    it("blocks edit calls with non-string path", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { edit: ["*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;
      const result = handler(makeToolCallEvent("edit", { path: 42 }));

      expect(result).toEqual({
        block: true,
        reason: 'edit tool call with non-string "path"',
      });
    });

    it("blocks edit calls with null input", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { edit: ["*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;
      const result = handler(makeToolCallEvent("edit", null));

      expect(result).toEqual({
        block: true,
        reason: 'edit tool call missing "path" in input',
      });
    });
  });

  describe("find restrictions", () => {
    it("restricts find tool calls by path pattern", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { find: ["src/*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;

      expect(
        handler(makeToolCallEvent("find", { path: "/home/user/proj/src/dir" })),
      ).toBeUndefined();
      expect(handler(makeToolCallEvent("find", { path: "/home/user/proj/docs/dir" }))).toEqual({
        block: true,
        reason: expect.stringContaining("docs/dir"),
      });
    });

    it("blocks find calls with missing path field", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { find: ["*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;
      const result = handler(makeToolCallEvent("find", { pattern: "*.ts" }));

      expect(result).toEqual({
        block: true,
        reason: 'find tool call missing "path" in input',
      });
    });

    it("blocks find call without explicit path — intentional: search without path restriction would bypass restriction", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { find: ["src/*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;
      const result = handler(makeToolCallEvent("find", { pattern: "*.ts", glob: "*.ts" }));

      expect(result).toEqual({
        block: true,
        reason: 'find tool call missing "path" in input',
      });
    });

    it("blocks find calls with non-string path", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { find: ["*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;
      const result = handler(makeToolCallEvent("find", { path: 42 }));

      expect(result).toEqual({
        block: true,
        reason: 'find tool call with non-string "path"',
      });
    });

    it("blocks find calls with null input", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { find: ["*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;
      const result = handler(makeToolCallEvent("find", null));

      expect(result).toEqual({
        block: true,
        reason: 'find tool call missing "path" in input',
      });
    });
  });

  describe("ls restrictions", () => {
    it("restricts ls tool calls by path pattern", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { ls: ["src/*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;

      expect(handler(makeToolCallEvent("ls", { path: "/home/user/proj/src/dir" }))).toBeUndefined();
      expect(handler(makeToolCallEvent("ls", { path: "/home/user/proj/docs/dir" }))).toEqual({
        block: true,
        reason: expect.stringContaining("docs/dir"),
      });
    });

    it("blocks ls calls with missing path field", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { ls: ["*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;
      const result = handler(makeToolCallEvent("ls", { limit: 50 }));

      expect(result).toEqual({
        block: true,
        reason: 'ls tool call missing "path" in input',
      });
    });

    it("blocks ls call without explicit path — intentional: listing without path restriction would bypass restriction", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { ls: ["src/*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;
      const result = handler(makeToolCallEvent("ls", { limit: 10 }));

      expect(result).toEqual({
        block: true,
        reason: 'ls tool call missing "path" in input',
      });
    });

    it("blocks ls calls with non-string path", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { ls: ["*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;
      const result = handler(makeToolCallEvent("ls", { path: 42 }));

      expect(result).toEqual({
        block: true,
        reason: 'ls tool call with non-string "path"',
      });
    });

    it("blocks ls calls with null input", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { ls: ["*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;
      const result = handler(makeToolCallEvent("ls", null));

      expect(result).toEqual({
        block: true,
        reason: 'ls tool call missing "path" in input',
      });
    });
  });

  describe("unknown tool blocking", () => {
    it("blocks calls when tool is in restrictions but has no input field mapping", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(pi, { unknownTool: ["*"] }, PROJECT_ROOT);

      const handler = pi.getHandler("tool_call")!;
      const result = handler(makeToolCallEvent("unknownTool", { command: "anything" }));

      expect(result).toEqual({
        block: true,
        reason: expect.stringContaining("cannot be restricted"),
      });
    });
  });

  describe("multiple tool restrictions", () => {
    it("restricts multiple tools independently", () => {
      const pi = makeMockPiWithHandlers();
      activateToolRestrictions(
        pi,
        {
          bash: ["git *"],
          write: ["src/*"],
        },
        PROJECT_ROOT,
      );

      const handler = pi.getHandler("tool_call")!;

      // Bash: allowed command passes through
      expect(handler(makeToolCallEvent("bash", { command: "git status" }))).toBeUndefined();
      // Bash: disallowed command is blocked
      expect(handler(makeToolCallEvent("bash", { command: "rm -rf /" }))).toEqual({
        block: true,
        reason: expect.stringContaining("rm -rf /"),
      });
      // Write: allowed path passes through
      expect(
        handler(makeToolCallEvent("write", { path: "/home/user/proj/src/allowed.ts" })),
      ).toBeUndefined();
      // Write: disallowed path is blocked
      expect(
        handler(makeToolCallEvent("write", { path: "/home/user/proj/blocked-write.ts" })),
      ).toEqual({
        block: true,
        reason: expect.stringContaining("blocked-write.ts"),
      });
      // Read: not restricted, passes through
      expect(handler(makeToolCallEvent("read", { path: "file.txt" }))).toBeUndefined();
    });
  });

  describe("empty map handling", () => {
    it("returns early when restrictions is an empty object", () => {
      const pi = makeMockPiWithHandlers();

      // Empty object shouldn't register a handler
      activateToolRestrictions(pi, {}, PROJECT_ROOT);
      expect(pi.on).not.toHaveBeenCalled();

      // Re-initialize pi for the second check
      const pi2 = makeMockPiWithHandlers();
      activateToolRestrictions(
        pi2,
        Object.create(null) as Record<string, readonly string[]>,
        PROJECT_ROOT,
      );
      expect(pi2.on).not.toHaveBeenCalled();
    });
  });
});
