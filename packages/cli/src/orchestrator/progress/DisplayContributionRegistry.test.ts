import { describe, expect, it } from "vitest";

import { createMutableState } from "./AccumulatedState";
import type { DisplayContribution } from "./DisplayContribution";
import { DisplayContributionRegistry } from "./DisplayContributionRegistry";

// ── Tests ────────────────────────────────────────────────────

describe("DisplayContributionRegistry", () => {
  describe("register", () => {
    it("accepts a handler for a type", () => {
      const registry = new DisplayContributionRegistry();
      registry.register("agent", () => {});
      expect(registry.has("agent")).toBe(true);
    });

    it("throws when registering a duplicate type", () => {
      const registry = new DisplayContributionRegistry();
      registry.register("agent", () => {});
      expect(() => registry.register("agent", () => {})).toThrow(
        "Display handler already registered for type: agent",
      );
    });

    it("allows registering multiple distinct types", () => {
      const registry = new DisplayContributionRegistry();
      registry.register("agent", () => {});
      registry.register("loop", () => {});
      registry.register("workspace", () => {});
      expect(registry.types()).toEqual(["agent", "loop", "workspace"]);
    });
  });

  describe("has", () => {
    it("returns true for a registered type", () => {
      const registry = new DisplayContributionRegistry();
      registry.register("status", () => {});
      expect(registry.has("status")).toBe(true);
    });

    it("returns false for an unregistered type", () => {
      const registry = new DisplayContributionRegistry();
      expect(registry.has("nonexistent")).toBe(false);
    });
  });

  describe("types", () => {
    it("returns an empty array when no handlers are registered", () => {
      const registry = new DisplayContributionRegistry();
      expect(registry.types()).toEqual([]);
    });

    it("returns all registered type names", () => {
      const registry = new DisplayContributionRegistry();
      registry.register("agent", () => {});
      registry.register("loop", () => {});
      expect(registry.types()).toEqual(["agent", "loop"]);
    });
  });

  describe("apply", () => {
    it("calls the handler for each matching contribution", () => {
      const registry = new DisplayContributionRegistry();
      const calls: string[] = [];
      registry.register("agent", (c) => {
        if (c.type === "agent") calls.push(c.agentId);
      });

      const contributions: DisplayContribution[] = [
        { type: "agent", agentId: "a1", agentStatus: "started" },
        { type: "agent", agentId: "a2", agentStatus: "done", agentPassed: true },
      ];

      registry.apply(createMutableState(), contributions);
      expect(calls).toEqual(["a1", "a2"]);
    });

    it("does not call handlers for unregistered types", () => {
      const registry = new DisplayContributionRegistry();
      const agentHandler = () => {
        throw new Error("should not be called");
      };
      registry.register("agent", agentHandler);

      const contributions: DisplayContribution[] = [{ type: "status", phase: "cleanup-done" }];

      expect(() => registry.apply(createMutableState(), contributions)).not.toThrow();
    });

    it("calls the correct handler for each contribution type", () => {
      const registry = new DisplayContributionRegistry();
      const seen: string[] = [];

      registry.register("agent", () => {
        seen.push("agent");
      });
      registry.register("loop", () => {
        seen.push("loop");
      });
      registry.register("workspace", () => {
        seen.push("workspace");
      });
      registry.register("status", () => {
        seen.push("status");
      });

      const contributions: DisplayContribution[] = [
        { type: "agent", agentId: "a1", agentStatus: "started" },
        { type: "loop", iteration: 1, maxIterations: 5 },
        { type: "workspace", workspace: "/tmp/ws" },
        { type: "status", phase: "cleanup-done" },
      ];

      registry.apply(createMutableState(), contributions);
      expect(seen).toEqual(["agent", "loop", "workspace", "status"]);
    });

    it("passes the mutable state to each handler", () => {
      const registry = new DisplayContributionRegistry();

      registry.register("agent", (c, s) => {
        if (c.type !== "agent") return;
        s.agentMap.set(c.agentId, { status: c.agentStatus });
      });

      const contributions: DisplayContribution[] = [
        { type: "agent", agentId: "a1", agentStatus: "done" },
      ];

      const state = createMutableState();
      registry.apply(state, contributions);

      expect(state.agentMap.get("a1")?.status).toBe("done");
    });

    it("handles empty contributions array without error", () => {
      const registry = new DisplayContributionRegistry();
      registry.register("agent", () => {
        throw new Error("should not be called");
      });

      expect(() => registry.apply(createMutableState(), [])).not.toThrow();
    });

    it("silently skips contributions whose type has no registered handler", () => {
      const registry = new DisplayContributionRegistry();
      // No handlers registered at all
      const contributions: DisplayContribution[] = [
        { type: "agent", agentId: "a1", agentStatus: "started" },
      ];

      expect(() => registry.apply(createMutableState(), contributions)).not.toThrow();
    });
  });
});
