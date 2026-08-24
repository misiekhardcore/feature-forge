/**
 * In-process integration test that drives real restricted tool calls
 * through pi's real extension machinery.
 *
 * Unlike the subprocess e2e tests (which verify that the extension loads
 * with FORGE_SPEC set), this suite loads the real child-side wiring —
 * `spec-resolution.ts` → `activateToolRestrictions()` — through pi's real
 * extension loader, API, and `ExtensionRunner` event dispatch, then emits
 * real `tool_call` events for `write` and `bash` and asserts the
 * allow/block decisions:
 *
 * - relative path patterns are resolved against `projectRoot`
 *   (`process.cwd()` at the call site) before matching absolute paths
 * - bash command patterns are matched verbatim, never resolved
 * - `!`-negated patterns block matching absolute paths
 *
 * The only stubbed surface is the runtime action plumbing (tool-state
 * getters/setters), which pi itself provides in a real session.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import {
  createEventBus,
  discoverAndLoadExtensions,
  type ExtensionActions,
  type ExtensionContextActions,
  ExtensionRunner,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  type ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

const FIXTURE_PATH = path.join(__dirname, "fixtures", "restriction-interceptor.extension.ts");

/** Runtime plumbing stubs — the surface pi itself provides in a real session. */
function makeRuntimeStubs(): {
  actions: ExtensionActions;
  contextActions: ExtensionContextActions;
} {
  let activeTools: string[] = [];
  return {
    actions: {
      sendMessage: () => {},
      sendUserMessage: () => {},
      appendEntry: () => {},
      setSessionName: () => {},
      getSessionName: () => undefined,
      setLabel: () => {},
      getActiveTools: () => activeTools,
      getAllTools: () => [],
      setActiveTools: (tools: string[]) => {
        activeTools = tools;
      },
      refreshTools: () => {},
      getCommands: () => [],
      setModel: async () => true,
      getThinkingLevel: () => "medium",
      setThinkingLevel: () => {},
    },
    contextActions: {
      getModel: () => undefined,
      getScopedModels: () => [],
      isIdle: () => true,
      isProjectTrusted: () => true,
      getSignal: () => undefined,
      abort: () => {},
      hasPendingMessages: () => false,
      shutdown: () => {},
      getContextUsage: () => undefined,
      compact: () => {},
      getSystemPrompt: () => "",
      getSystemPromptOptions: () => ({ cwd: process.cwd() }),
    },
  };
}

/**
 * Load the real spec-resolution extension fixture through pi's real loader
 * and create a runner bound to runtime stubs.
 */
async function createRestrictionRunner(cwd: string): Promise<ExtensionRunner> {
  const eventBus = createEventBus();
  const { extensions, runtime, errors } = await discoverAndLoadExtensions(
    [FIXTURE_PATH],
    cwd,
    path.join(cwd, ".pi-test-agent"),
    eventBus,
  );
  expect(errors).toEqual([]);
  expect(extensions.length).toBeGreaterThan(0);

  const { actions, contextActions } = makeRuntimeStubs();
  const runner = new ExtensionRunner(
    extensions,
    runtime,
    cwd,
    SessionManager.inMemory(cwd),
    new ModelRegistry(
      await ModelRuntime.create({
        authPath: path.join(cwd, "auth.json"),
        refreshOnCreate: false,
      }),
    ),
  );
  runner.bindCore(actions, contextActions);
  return runner;
}

function makeWriteCall(toolCallId: string, filePath: string): ToolCallEvent {
  return { type: "tool_call", toolCallId, toolName: "write", input: { path: filePath } };
}

function makeBashCall(toolCallId: string, command: string): ToolCallEvent {
  return { type: "tool_call", toolCallId, toolName: "bash", input: { command } };
}

describe("tool-restrictions interceptor integration", () => {
  let tmp: string;

  afterEach(() => {
    delete process.env.FORGE_SPEC;
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("resolves relative write patterns against projectRoot before matching", async () => {
    tmp = mkdtempSync(path.join(tmpdir(), "forge-interceptor-"));
    process.env.FORGE_SPEC = JSON.stringify({
      id: "restricted",
      role: "restricted",
      systemPrompt: "restricted agent",
      toolRestrictions: { write: [".forge/worktrees/**/NOTES.md"] },
      excludedTools: [],
    });

    const runner = await createRestrictionRunner(tmp);
    await runner.emit({ type: "session_start", reason: "startup" });

    const cwd = process.cwd();

    // Allowed: relative pattern resolves to `<cwd>/.forge/worktrees/**/NOTES.md`.
    await expect(
      runner.emitToolCall(
        makeWriteCall("w-allow", path.join(cwd, ".forge", "worktrees", "ws-abc", "NOTES.md")),
      ),
    ).resolves.toBeUndefined();

    // Blocked: absolute path outside the resolved pattern.
    const blocked = await runner.emitToolCall(
      makeWriteCall("w-block", path.join(cwd, "src", "secrets.ts")),
    );
    expect(blocked).toMatchObject({ block: true });
    expect(blocked?.reason).toContain("secrets.ts");
  });

  it("matches bash command patterns verbatim without projectRoot resolution", async () => {
    tmp = mkdtempSync(path.join(tmpdir(), "forge-interceptor-"));
    process.env.FORGE_SPEC = JSON.stringify({
      id: "restricted",
      role: "restricted",
      systemPrompt: "restricted agent",
      toolRestrictions: { bash: ["git *", "npm *"] },
      excludedTools: [],
    });

    const runner = await createRestrictionRunner(tmp);
    await runner.emit({ type: "session_start", reason: "startup" });

    await expect(
      runner.emitToolCall(makeBashCall("b-allow-1", "git status")),
    ).resolves.toBeUndefined();
    await expect(
      runner.emitToolCall(makeBashCall("b-allow-2", "npm test")),
    ).resolves.toBeUndefined();
    const blocked = await runner.emitToolCall(makeBashCall("b-block", "rm -rf /"));
    expect(blocked).toMatchObject({ block: true });
    expect(blocked?.reason).toContain("rm -rf /");
  });

  it("blocks absolute paths matching a negated pattern after resolution", async () => {
    tmp = mkdtempSync(path.join(tmpdir(), "forge-interceptor-"));
    process.env.FORGE_SPEC = JSON.stringify({
      id: "restricted",
      role: "restricted",
      systemPrompt: "restricted agent",
      toolRestrictions: {
        write: [".forge/worktrees/**/NOTES.md", "!.forge/worktrees/**/BAD-NOTES.md"],
      },
      excludedTools: [],
    });

    const runner = await createRestrictionRunner(tmp);
    await runner.emit({ type: "session_start", reason: "startup" });

    const cwd = process.cwd();

    await expect(
      runner.emitToolCall(
        makeWriteCall("w-ok", path.join(cwd, ".forge", "worktrees", "ws-abc", "NOTES.md")),
      ),
    ).resolves.toBeUndefined();
    const negated = await runner.emitToolCall(
      makeWriteCall("w-neg", path.join(cwd, ".forge", "worktrees", "ws-abc", "BAD-NOTES.md")),
    );
    expect(negated).toMatchObject({ block: true });
    expect(negated?.reason).toContain("BAD-NOTES.md");
  });

  it("does not register an interceptor when the spec has no restrictions", async () => {
    tmp = mkdtempSync(path.join(tmpdir(), "forge-interceptor-"));
    process.env.FORGE_SPEC = JSON.stringify({
      id: "open",
      role: "open",
      systemPrompt: "open agent",
      toolRestrictions: { write: [], bash: [] },
      excludedTools: [],
    });

    const runner = await createRestrictionRunner(tmp);
    await runner.emit({ type: "session_start", reason: "startup" });

    await expect(
      runner.emitToolCall(makeWriteCall("w-free", path.join(process.cwd(), "anywhere", "file.ts"))),
    ).resolves.toBeUndefined();
  });
});
