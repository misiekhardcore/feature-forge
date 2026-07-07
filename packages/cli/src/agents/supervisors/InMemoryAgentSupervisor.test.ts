import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeMockFactory, makeMockPi, makeSpec, MockAgent } from "../../test-utils";
import { AgentCreationError, AgentFactory } from "../factories/AgentFactory";
import { AgentSpecification } from "../specifications/AgentSpecification";
import { InMemoryAgentSupervisor } from "./InMemoryAgentSupervisor";

describe("InMemoryAgentSupervisor", () => {
  let factory: AgentFactory;
  let supervisor: InMemoryAgentSupervisor;

  beforeEach(() => {
    factory = makeMockFactory();
    supervisor = new InMemoryAgentSupervisor(factory);
  });

  describe("spawn", () => {
    it("creates an agent via the factory and tracks it", async () => {
      const spec = makeSpec("agent-1");
      const agent = await supervisor.spawnGuest(spec);
      expect(agent.id).toBe("agent-1");
      expect(factory.create).toHaveBeenCalledWith(spec);
    });

    it("re-throws factory errors", async () => {
      (factory.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new AgentCreationError("bad", "nope"),
      );
      await expect(supervisor.spawnGuest(makeSpec("bad"))).rejects.toThrow(AgentCreationError);
    });
  });

  describe("getAgent", () => {
    it("returns undefined for unknown agent", () => {
      expect(supervisor.getAgent("nonexistent")).toBeUndefined();
    });

    it("returns agent by string id", async () => {
      const spec = makeSpec("my-agent");
      const agent = await supervisor.spawnGuest(spec);
      expect(supervisor.getAgent("my-agent")).toBe(agent);
    });
  });

  describe("getAllAgents", () => {
    it("returns empty array initially", () => {
      expect(supervisor.getAllAgents()).toEqual([]);
    });

    it("returns all spawned agents", async () => {
      const a1 = await supervisor.spawnGuest(makeSpec("a1"));
      const a2 = await supervisor.spawnGuest(makeSpec("a2"));
      const all = supervisor.getAllAgents();
      expect(all).toHaveLength(2);
      expect(all).toContain(a1);
      expect(all).toContain(a2);
    });
  });

  describe("destroyAgent", () => {
    it("destroys a tracked agent and removes from map", async () => {
      await supervisor.spawnGuest(makeSpec("to-destroy"));
      expect(supervisor.getAgent("to-destroy")).toBeDefined();
      await supervisor.destroyAgent("to-destroy");
      expect(supervisor.getAgent("to-destroy")).toBeUndefined();
    });

    it("is a no-op for unknown agents", async () => {
      await supervisor.destroyAgent("unknown");
      expect(supervisor.getAllAgents()).toEqual([]);
    });
  });

  describe("destroyAll", () => {
    it("destroys all agents and clears the map", async () => {
      await supervisor.spawnGuest(makeSpec("a"));
      await supervisor.spawnGuest(makeSpec("b"));
      expect(supervisor.getAllAgents()).toHaveLength(2);
      await supervisor.destroyAll();
      expect(supervisor.getAllAgents()).toEqual([]);
    });

    it("handles empty map gracefully", async () => {
      await supervisor.destroyAll();
      expect(supervisor.getAllAgents()).toEqual([]);
    });
  });

  describe("runAgent", () => {
    it("full lifecycle removes agent after completion", async () => {
      const pi = makeMockPi();
      await supervisor.runAgent(makeSpec("runner"), "do it", pi);
      expect(supervisor.getAgent("runner")).toBeUndefined();
    });

    it("sends error notification when spawn fails", async () => {
      (factory.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Spawn failed"));
      const pi = makeMockPi();
      await supervisor.runAgent(makeSpec("fail-spawn"), "task", pi);
      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("Spawn failed") }),
        expect.any(Object),
      );
    });

    it("sends error notification when spawn fails with non-Error", async () => {
      (factory.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce("just a string error");
      const pi = makeMockPi();
      await supervisor.runAgent(makeSpec("fail-str"), "task", pi);
      expect(pi.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("just a string error") }),
        expect.any(Object),
      );
    });

    it("cleans up even when task execution fails", async () => {
      const mockCreate: AgentFactory["create"] = vi
        .fn()
        .mockImplementation(async (spec: AgentSpecification) => {
          const agent = new MockAgent(spec.id);
          vi.spyOn(agent, "executeTask").mockRejectedValueOnce(new Error("Execution error"));
          vi.spyOn(agent, "deliverError").mockImplementation(() => {});
          return agent;
        });
      factory.create = mockCreate;

      const pi = makeMockPi();
      await supervisor.runAgent(makeSpec("fail-exec"), "bad-task", pi);
      expect(supervisor.getAgent("fail-exec")).toBeUndefined();
    });

    it("cleans up when task execution fails with non-Error", async () => {
      const mockCreate: AgentFactory["create"] = vi
        .fn()
        .mockImplementation(async (spec: AgentSpecification) => {
          const agent = new MockAgent(spec.id);
          vi.spyOn(agent, "executeTask").mockRejectedValueOnce("string error");
          vi.spyOn(agent, "deliverError").mockImplementation(() => {});
          return agent;
        });
      factory.create = mockCreate;

      const pi = makeMockPi();
      await supervisor.runAgent(makeSpec("fail-str"), "bad-task", pi);
      expect(supervisor.getAgent("fail-str")).toBeUndefined();
    });
  });

  describe("printAgentError", () => {
    it("sends formatted spawn error via pi", () => {
      const pi = makeMockPi();
      supervisor.printAgentError("my-agent", "do stuff", new Error("Boom!"), pi);
      expect(pi.sendMessage).toHaveBeenCalledWith(
        {
          customType: "agent_spawn_error",
          content: '## ❌ Agent "my-agent" spawn failed: do stuff\n\nBoom!',
          display: true,
        },
        { triggerTurn: false },
      );
    });
  });
});
