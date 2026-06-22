import { describe, it, expect } from "vitest";
import { AgentPermissions } from "./AgentGovernancePolicy";

describe("AgentPermissions", () => {
  it("allowedTools defaults to null (unrestricted)", () => {
    const p = new AgentPermissions({});
    expect(p.allowedTools).toBeNull();
  });

  it("timeToLiveMs defaults to undefined", () => {
    const p = new AgentPermissions({});
    expect(p.timeToLiveMs).toBeUndefined();
  });

  it("maxToolCalls defaults to undefined", () => {
    const p = new AgentPermissions({});
    expect(p.maxToolCalls).toBeUndefined();
  });

  it("stores provided allowedTools", () => {
    const p = new AgentPermissions({ allowedTools: ["read", "grep"] });
    expect(p.allowedTools).toEqual(["read", "grep"]);
  });

  it("stores provided timeToLiveMs", () => {
    const p = new AgentPermissions({ timeToLiveMs: 30000 });
    expect(p.timeToLiveMs).toBe(30000);
  });

  it("stores provided maxToolCalls", () => {
    const p = new AgentPermissions({ maxToolCalls: 50 });
    expect(p.maxToolCalls).toBe(50);
  });

  it("accepts null explicitly for allowedTools", () => {
    const p = new AgentPermissions({ allowedTools: null });
    expect(p.allowedTools).toBeNull();
  });

  it("all false-y values work correctly", () => {
    const p = new AgentPermissions({ allowedTools: [], timeToLiveMs: 0, maxToolCalls: 0 });
    expect(p.allowedTools).toEqual([]);
    expect(p.timeToLiveMs).toBe(0);
    expect(p.maxToolCalls).toBe(0);
  });
});
