import { makeSpec, MockAgent } from "@feature-forge/cli/src/test-utils";
import { AgentStatus } from "@feature-forge/core";
import { describe, expect, it } from "vitest";

import { Agent } from "./Agent";
import { isSubprocessAgent } from "./guards";

describe("agent guards", () => {
  describe("isSubprocessAgent", () => {
    it("identifies a subprocess-shaped agent structurally", () => {
      const agent = new MockAgent("sub", { role: "tester" }) as InstanceType<typeof Agent>;
      expect(isSubprocessAgent(agent)).toBe(true);
    });

    it("rejects a plain agent with no executeTask", () => {
      // The bare agent is not subprocess-shaped — it carries the in-session
      // family discriminator, and structural narrowing must reject it.
      const bare: Agent = {
        kind: "in-session",
        id: "bare",
        specification: makeSpec("bare", { role: "bare" }),
        createdAt: new Date(),
        status: AgentStatus.Spawned,
        destroy: async () => {},
      };
      expect(isSubprocessAgent(bare)).toBe(false);
    });
  });
});
