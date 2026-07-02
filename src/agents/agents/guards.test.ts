import { describe, expect, it } from "vitest";

import { MockAgent } from "../../test-utils";
import { Agent, getRole, isSubprocessAgent } from "../agents";
import { AgentStatus } from "../base";

describe("agent guards", () => {
  describe("getRole", () => {
    it("returns the specification role for a tracked agent", () => {
      const agent = new MockAgent("a1", { role: "builder" }) as unknown as InstanceType<
        typeof Agent
      >;
      expect(getRole(agent)).toBe("builder");
    });

    it("falls back to 'unknown' when the base agent carries no specification", () => {
      const bare: Agent = {
        id: "bare",
        createdAt: new Date(),
        status: AgentStatus.Spawned,
        destroy: async () => {},
      } as unknown as Agent;
      expect(getRole(bare)).toBe("unknown");
    });
  });

  describe("isSubprocessAgent", () => {
    it("identifies a subprocess-shaped agent structurally", () => {
      const agent = new MockAgent("sub", { role: "tester" }) as unknown as InstanceType<
        typeof Agent
      >;
      expect(isSubprocessAgent(agent)).toBe(true);
      expect(getRole(agent)).toBe("tester");
    });

    it("rejects a plain agent with no executeTask", () => {
      const bare: Agent = {
        id: "bare",
        createdAt: new Date(),
        status: AgentStatus.Spawned,
        destroy: async () => {},
      } as unknown as Agent;
      expect(isSubprocessAgent(bare)).toBe(false);
    });
  });
});
