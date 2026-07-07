import { describe, expect, it } from "vitest";

import { AgentStatus } from "./AgentStatus";

describe("AgentStatus", () => {
  it("has five lifecycle states with correct string values", () => {
    expect(AgentStatus.Spawned).toBe("Spawned");
    expect(AgentStatus.Running).toBe("Running");
    expect(AgentStatus.Completed).toBe("Completed");
    expect(AgentStatus.Failed).toBe("Failed");
    expect(AgentStatus.Cancelled).toBe("Cancelled");
  });

  it("has exactly five members", () => {
    expect(Object.keys(AgentStatus)).toHaveLength(5);
  });
});
