import { describe, expect, it } from "vitest";

import { AgentCreationError } from "./AgentFactory";

describe("AgentCreationError", () => {
  it("creates an error with the specification id in the message", () => {
    const error = new AgentCreationError("agent-1", "Network timeout");
    expect(error.message).toContain("agent-1");
    expect(error.message).toContain("Network timeout");
    expect(error.specificationId).toBe("agent-1");
    expect(error.name).toBe("AgentCreationError");
  });

  it("captures the cause when provided", () => {
    const cause = new Error("Underlying issue");
    const error = new AgentCreationError("agent-2", "Failed", cause);
    expect(error.cause).toBe(cause);
  });

  it("works without a cause", () => {
    const error = new AgentCreationError("agent-3", "Boom");
    expect(error.cause).toBeUndefined();
  });

  it("stores undefined cause when explicitly passed", () => {
    const error = new AgentCreationError("agent-4", "Fail", undefined);
    expect(error.cause).toBeUndefined();
  });
});
