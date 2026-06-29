import { describe, expect, it } from "vitest";

import { AgentSpecification } from "../specifications/AgentSpecification";
import { DefaultAgentGovernancePolicy } from "./DefaultAgentGovernancePolicy";

function makeSpec(overrides: Partial<ConstructorParameters<typeof AgentSpecification>[0]> = {}) {
  return new (class extends AgentSpecification {
    constructor() {
      super({
        id: "test",
        role: "tester",
        systemPrompt: "test",
        ...overrides,
      });
    }
  })();
}

describe("DefaultAgentGovernancePolicy", () => {
  const policy = new DefaultAgentGovernancePolicy();

  describe("resolvePermissions", () => {
    it("returns null (unrestricted) when tools is empty", async () => {
      const spec = makeSpec({ tools: [] });
      const perms = await policy.resolvePermissions(spec);
      expect(perms.allowedTools).toBeNull();
    });

    it("returns allowedTools when tools is non-empty", async () => {
      const spec = makeSpec({ tools: ["read", "grep"] });
      const perms = await policy.resolvePermissions(spec);
      expect(perms.allowedTools).toEqual(["read", "grep"]);
    });

    it("timeToLiveMs is undefined (no default timeout)", async () => {
      const spec = makeSpec();
      const perms = await policy.resolvePermissions(spec);
      expect(perms.timeToLiveMs).toBeUndefined();
    });

    it("maxToolCalls is undefined (no default limit)", async () => {
      const spec = makeSpec();
      const perms = await policy.resolvePermissions(spec);
      expect(perms.maxToolCalls).toBeUndefined();
    });
  });

  describe("isActionAllowed", () => {
    it("allows any action when tools is empty (unrestricted)", async () => {
      const spec = makeSpec({ tools: [] });
      expect(await policy.isActionAllowed(spec, "bash")).toBe(true);
      expect(await policy.isActionAllowed(spec, "write")).toBe(true);
    });

    it("allows action when it is in tools", async () => {
      const spec = makeSpec({ tools: ["read", "grep"] });
      expect(await policy.isActionAllowed(spec, "read")).toBe(true);
      expect(await policy.isActionAllowed(spec, "grep")).toBe(true);
    });

    it("denies action when it is not in tools", async () => {
      const spec = makeSpec({ tools: ["read", "grep"] });
      expect(await policy.isActionAllowed(spec, "bash")).toBe(false);
      expect(await policy.isActionAllowed(spec, "write")).toBe(false);
    });
  });
});
