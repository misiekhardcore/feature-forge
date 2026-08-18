import { AgentStatus } from "@feature-forge/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToolRegistry } from "../../registry";
import { makeMockPi, makeSpec } from "../../test-utils";
import { SetSessionNameTool } from "../../tools";
import type { AgentSpecification } from "../specifications";
import { SessionAgent } from "./SessionAgent";

describe("SessionAgent", () => {
  let spec: AgentSpecification;

  beforeEach(() => {
    spec = makeSpec("session-agent", {
      role: "orchestrator",
      systemPrompt: "# You are the orchestrator.",
      toolRestrictions: { run_build_loop: [], bash: [] },
    });
  });

  describe("construction (spec-based)", () => {
    it("starts in Spawned status", () => {
      const agent = new SessionAgent(spec);
      expect(agent.status).toBe(AgentStatus.Spawned);
    });

    it("takes id and persona from the specification", () => {
      const agent = new SessionAgent(spec);
      expect(agent.id).toBe("session-agent");
      expect(agent.specification).toBe(spec);
      expect(agent.specification.systemPrompt).toBe("# You are the orchestrator.");
    });

    it("identifies as the in-session family", () => {
      const agent = new SessionAgent(spec);
      expect(agent.kind).toBe("in-session");
    });
  });

  describe("mount", () => {
    it("transitions to Running", () => {
      const agent = new SessionAgent(spec);
      const pi = makeMockPi();
      agent.mount(pi, "build the feature");
      expect(agent.status).toBe(AgentStatus.Running);
    });

    it("saves default tools before overriding them", () => {
      const agent = new SessionAgent(spec);
      const pi = makeMockPi();
      vi.mocked(pi.getActiveTools).mockReturnValue(["read", "bash", "edit"]);
      agent.mount(pi, "task");

      expect(pi.getActiveTools).toHaveBeenCalled();
      // Default tools are captured internally and restored on unmount.
    });

    it("does not overwrite savedTools on double mount", () => {
      const agent = new SessionAgent(spec);
      const pi = makeMockPi();
      vi.mocked(pi.getActiveTools).mockReturnValue(["read", "bash"]);
      agent.mount(pi, "task1");

      // Re-entrant mount: flow tools are now active.
      vi.mocked(pi.getActiveTools).mockReturnValue(["flow-tool"]);
      agent.mount(pi, "task2");

      agent.unmount();

      // The original pre-flow tools are restored, never the flow tools.
      expect(pi.setActiveTools).toHaveBeenLastCalledWith(["read", "bash"]);
      expect(pi.setActiveTools).not.toHaveBeenCalledWith(["flow-tool"]);
    });

    it("isMounted returns true after mount", () => {
      const agent = new SessionAgent(spec);
      const pi = makeMockPi();
      agent.mount(pi, "task");
      expect(agent.isMounted).toBe(true);
    });

    it("sets a fallback session name on mount", () => {
      const agent = new SessionAgent(spec);
      const pi = makeMockPi();
      agent.mount(pi, "build the feature");
      expect(pi.setSessionName).toHaveBeenCalledWith("session-agent");
    });

    it("derives the fallback session name from the spec id", () => {
      const reviewSpec = makeSpec("review-orchestrator", {
        role: "orchestrator",
        systemPrompt: "# You are the reviewer.",
      });
      const agent = new SessionAgent(reviewSpec);
      const pi = makeMockPi();
      agent.mount(pi, "task");
      expect(pi.setSessionName).toHaveBeenCalledWith("review-orchestrator");
    });

    it("registers a before_agent_start hook prepending the persona system prompt", () => {
      const agent = new SessionAgent(spec);
      const pi = makeMockPi();
      agent.mount(pi, "task");

      expect(pi.on).toHaveBeenCalledWith("before_agent_start", expect.any(Function));
      const handler = (pi.on as ReturnType<typeof vi.fn>).mock.calls[0][1] as (event: {
        systemPrompt: string;
      }) => { systemPrompt: string } | undefined;

      const result = handler({ systemPrompt: "base prompt" });
      expect(result!.systemPrompt).toBe(
        "## Custom system prompt\n\n# You are the orchestrator.\n\n---\n\nbase prompt",
      );
    });

    it("prepends the persona system prompt (not appends)", () => {
      const agent = new SessionAgent(spec);
      const pi = makeMockPi();
      agent.mount(pi, "task");

      const handler = (pi.on as ReturnType<typeof vi.fn>).mock.calls[0][1] as (event: {
        systemPrompt: string;
      }) => { systemPrompt: string } | undefined;

      const result = handler({ systemPrompt: "base prompt" })!;
      const personaIndex = result.systemPrompt.indexOf("# You are the orchestrator.");
      const baseIndex = result.systemPrompt.indexOf("base prompt");
      expect(personaIndex).toBeGreaterThanOrEqual(0);
      expect(baseIndex).toBeGreaterThan(personaIndex);
    });

    it("sends the resolved task as a user message", () => {
      const agent = new SessionAgent(spec);
      const pi = makeMockPi();
      agent.mount(pi, "Build: add auth");

      expect(pi.sendUserMessage).toHaveBeenCalledOnce();
      expect(pi.sendUserMessage).toHaveBeenCalledWith("Build: add auth");
    });

    it("sets active tools from the spec when any are declared", () => {
      const agent = new SessionAgent(spec);
      const pi = makeMockPi();
      agent.mount(pi, "task");

      expect(pi.setActiveTools).toHaveBeenCalledWith(["run_build_loop", "bash"]);
    });

    it("does not call setActiveTools when the spec declares no tools", () => {
      const noToolsSpec = makeSpec("no-tools", {
        systemPrompt: "persona",
      });
      const agent = new SessionAgent(noToolsSpec);
      const pi = makeMockPi();
      agent.mount(pi, "task");

      expect(pi.setActiveTools).not.toHaveBeenCalled();
    });

    it("filters default tools by full exclusions when the spec declares no tools", () => {
      const excludedSpec = makeSpec("excluded", {
        systemPrompt: "persona",
        excludedTools: ["bash", "write"],
      });
      const agent = new SessionAgent(excludedSpec);
      const pi = makeMockPi();
      vi.mocked(pi.getActiveTools).mockReturnValue(["read", "bash", "edit", "write"]);
      agent.mount(pi, "task");

      expect(pi.setActiveTools).toHaveBeenCalledWith(["read", "edit"]);
    });

    it("keeps default tools when excludedTools only has partial restrictions", () => {
      const partialSpec = makeSpec("partial-only", {
        systemPrompt: "persona",
        excludedTools: ["bash:rm *"],
      });
      const agent = new SessionAgent(partialSpec);
      const pi = makeMockPi();
      vi.mocked(pi.getActiveTools).mockReturnValue(["read", "bash", "edit"]);
      agent.mount(pi, "task");

      // bash is only restricted, not removed — defaults stay untouched.
      expect(pi.setActiveTools).not.toHaveBeenCalled();
    });

    it("merges partial restriction patterns from excludedTools into toolRestrictions", () => {
      const restrictedSpec = makeSpec("partial", {
        systemPrompt: "persona",
        toolRestrictions: { bash: ["git *"] },
        excludedTools: ["bash:rm *"],
      });
      const agent = new SessionAgent(restrictedSpec);
      const pi = makeMockPi();
      agent.mount(pi, "task");

      expect(pi.on).toHaveBeenCalledWith("tool_call", expect.any(Function));
      const toolCallHandler = (pi.on as ReturnType<typeof vi.fn>).mock.calls.find(
        (call: unknown[]) => call[0] === "tool_call",
      )![1] as (event: {
        toolName: string;
        input: { command: string };
      }) => { block: boolean; reason: string } | undefined;

      // Spec pattern allows git status.
      expect(
        toolCallHandler({ toolName: "bash", input: { command: "git status" } }),
      ).toBeUndefined();
      // excludedTools partial pattern allows rm commands.
      expect(toolCallHandler({ toolName: "bash", input: { command: "rm -rf /" } })).toBeUndefined();
      // Commands matching neither pattern are blocked.
      expect(toolCallHandler({ toolName: "bash", input: { command: "npm install" } })).toEqual({
        block: true,
        reason: expect.stringContaining("npm install"),
      });
    });

    it("registers tool_call handler when restrictions have patterns", () => {
      const restrictedSpec = makeSpec("restricted", {
        role: "orchestrator",
        systemPrompt: "# Restricted",
        toolRestrictions: { read: ["src/**"] },
      });
      const agent = new SessionAgent(restrictedSpec);
      const pi = makeMockPi();
      agent.mount(pi, "task");

      expect(pi.on).toHaveBeenCalledWith("tool_call", expect.any(Function));
    });

    it("does not register tool_call handler when all restrictions are empty", () => {
      const agent = new SessionAgent(spec);
      const pi = makeMockPi();
      agent.mount(pi, "task");

      // Find all calls to pi.on and ensure none are for "tool_call"
      const toolCallCalls = (pi.on as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: unknown[]) => call[0] === "tool_call",
      );
      expect(toolCallCalls).toHaveLength(0);
    });
  });

  describe("integration: set_session_name at registration site", () => {
    it("mounts with fallback name and the registered tool renames the session end-to-end", async () => {
      const pi = makeMockPi();

      // AC1: mount sets the fallback session name.
      const agent = new SessionAgent(spec);
      agent.mount(pi, "build the feature");
      expect(pi.setSessionName).toHaveBeenCalledWith("session-agent");

      // Registration site (index.ts): registerInstance wires the tool to pi.
      const tool = new SetSessionNameTool(pi);
      const registry = new ToolRegistry(null, pi);
      registry.registerInstance(tool);

      expect(pi.registerTool).toHaveBeenCalledWith(tool);
      expect(tool.name).toBe("set_session_name");
      expect(tool.renderShell).toBe("self");

      // AC2: the registry-held tool can rename the session end-to-end.
      expect(registry.get("set_session_name")).toBe(tool);

      const result = await tool.execute("call-1", { name: "implement #172" }, undefined);
      expect(pi.setSessionName).toHaveBeenCalledWith("implement #172");
      expect(result).toEqual({
        content: [{ type: "text", text: "Session named: implement #172" }],
      });
    });
  });

  describe("unmount", () => {
    it("transitions to Cancelled", () => {
      const agent = new SessionAgent(spec);
      const pi = makeMockPi();
      agent.mount(pi, "task");
      agent.unmount();
      expect(agent.status).toBe(AgentStatus.Cancelled);
    });

    it("isMounted returns false after unmount", () => {
      const agent = new SessionAgent(spec);
      const pi = makeMockPi();
      agent.mount(pi, "task");
      agent.unmount();
      expect(agent.isMounted).toBe(false);
    });

    it("restores default tools that were captured at mount time", () => {
      const agent = new SessionAgent(spec);
      const pi = makeMockPi();
      vi.mocked(pi.getActiveTools).mockReturnValue(["read", "bash", "edit", "write"]);
      agent.mount(pi, "task");

      // mount() calls setActiveTools with the spec tools
      expect(pi.setActiveTools).toHaveBeenCalledWith(["run_build_loop", "bash"]);

      agent.unmount();

      // unmount should restore what getActiveTools returned at mount time
      expect(pi.setActiveTools).toHaveBeenLastCalledWith(["read", "bash", "edit", "write"]);
    });

    it("does not call setActiveTools when unmount is called without mount", () => {
      const agent = new SessionAgent(spec);
      const pi = makeMockPi();
      agent.unmount();
      expect(pi.setActiveTools).not.toHaveBeenCalled();
    });

    it("does not restore tools when the saved defaults are empty", () => {
      const noToolsSpec = makeSpec("no-tools", { systemPrompt: "persona" });
      const agent = new SessionAgent(noToolsSpec);
      const pi = makeMockPi();
      agent.mount(pi, "task");
      agent.unmount();
      expect(pi.setActiveTools).not.toHaveBeenCalled();
    });

    it("handler returns empty object after unmount, suppressing the persona", () => {
      const agent = new SessionAgent(spec);
      const pi = makeMockPi();
      agent.mount(pi, "task");

      const handler = (pi.on as ReturnType<typeof vi.fn>).mock.calls[0][1] as (event: {
        systemPrompt: string;
      }) => { systemPrompt?: string };

      // Before unmount: handler appends persona
      expect(handler({ systemPrompt: "base" })).toBeDefined();

      agent.unmount();

      // After unmount: handler returns undefined (skips persona injection)
      expect(handler({ systemPrompt: "base" })).toEqual({});
    });
  });

  describe("destroy", () => {
    it("transitions to Cancelled", async () => {
      const agent = new SessionAgent(spec);
      const pi = makeMockPi();
      agent.mount(pi, "task");
      await expect(agent.destroy()).resolves.toBeUndefined();
      expect(agent.status).toBe(AgentStatus.Cancelled);
    });

    it("isMounted returns false after destroy", async () => {
      const agent = new SessionAgent(spec);
      const pi = makeMockPi();
      agent.mount(pi, "task");
      await agent.destroy();
      expect(agent.isMounted).toBe(false);
    });
  });
});
