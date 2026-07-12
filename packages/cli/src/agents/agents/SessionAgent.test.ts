import { AgentStatus } from "@feature-forge/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeMockPi, makeSpec } from "../../test-utils";
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

    it("isMounted returns true after mount", () => {
      const agent = new SessionAgent(spec);
      const pi = makeMockPi();
      agent.mount(pi, "task");
      expect(agent.isMounted).toBe(true);
    });

    it("registers a before_agent_start hook appending the persona system prompt", () => {
      const agent = new SessionAgent(spec);
      const pi = makeMockPi();
      agent.mount(pi, "task");

      expect(pi.on).toHaveBeenCalledWith("before_agent_start", expect.any(Function));
      const handler = (pi.on as ReturnType<typeof vi.fn>).mock.calls[0][1] as (event: {
        systemPrompt: string;
      }) => { systemPrompt: string } | undefined;

      const result = handler({ systemPrompt: "base prompt" });
      expect(result!.systemPrompt).toBe(
        "base prompt\n\n---\n\n## Custom system prompt\n\n# You are the orchestrator.",
      );
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
