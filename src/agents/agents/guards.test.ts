import { describe, expect, it } from "vitest";

import { makeSpec, MockAgent } from "../../test-utils";
import { Agent, isSubprocessAgent } from "../agents";
import { AgentStatus } from "../base";

describe("agent guards", () => {
  describe("isSubprocessAgent", () => {
    it("identifies a subprocess-shaped agent structurally", () => {
      const agent = new MockAgent("sub", { role: "tester" }) as InstanceType<typeof Agent>;
      expect(isSubprocessAgent(agent)).toBe(true);
    });

    it("rejects a plain agent with no executeTask", () => {
      const bare: Agent = {
        id: "bare",
        specification: makeSpec("bare", { role: "bare" }),
        createdAt: new Date(),
        status: AgentStatus.Spawned,
        destroy: async () => {},
      } as Agent;
      expect(isSubprocessAgent(bare)).toBe(false);
    });
  });
});
