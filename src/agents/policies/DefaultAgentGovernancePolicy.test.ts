import { describe, expect, it } from "vitest";

import { AgentIdentifier } from "../base/AgentIdentifier";
import { AgentSpecification } from "../specifications/AgentSpecification";
import { DefaultAgentGovernancePolicy } from "./DefaultAgentGovernancePolicy";

function makeSpec(overrides: Partial<ConstructorParameters<typeof AgentSpecification>[0]> = {}) {
  return new (class extends AgentSpecification {
    constructor() {
      super({
        identifier: new AgentIdentifier("test"),
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
    it("returns null (unrestricted) when toolNames is empty", async () => {
      const spec = makeSpec({ toolNames: [] });
      const perms = await policy.resolvePermissions(spec);
      expect(perms.allowedTools).toBeNull();
    });

    it("returns allowedTools when toolNames is non-empty", async () => {
      const spec = makeSpec({ toolNames: ["read", "grep"] });
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
    it("allows any action when toolNames is empty (unrestricted)", async () => {
      const spec = makeSpec({ toolNames: [] });
      expect(await policy.isActionAllowed(spec, "bash")).toBe(true);
      expect(await policy.isActionAllowed(spec, "write")).toBe(true);
    });

    it("allows action when it is in toolNames", async () => {
      const spec = makeSpec({ toolNames: ["read", "grep"] });
      expect(await policy.isActionAllowed(spec, "read")).toBe(true);
      expect(await policy.isActionAllowed(spec, "grep")).toBe(true);
    });

    it("denies action when it is not in toolNames", async () => {
      const spec = makeSpec({ toolNames: ["read", "grep"] });
      expect(await policy.isActionAllowed(spec, "bash")).toBe(false);
      expect(await policy.isActionAllowed(spec, "write")).toBe(false);
    });
  });
});
