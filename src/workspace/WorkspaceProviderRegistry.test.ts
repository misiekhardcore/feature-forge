import { describe, expect, it } from "vitest";

import { WorkspaceProvider } from "./WorkspaceProvider";
import { WorkspaceProviderRegistry } from "./WorkspaceProviderRegistry";

// ── Helpers ──────────────────────────────────────────────────

class FakeProvider extends WorkspaceProvider {
  readonly label: string;

  constructor(label: string) {
    super();
    this.label = label;
  }

  override async createWorkspace(_workspaceId: string): Promise<string> {
    return `/fake/${this.label}`;
  }

  override async destroyWorkspace(_path: string): Promise<void> {
    // no-op
  }
}

// ── Tests ────────────────────────────────────────────────────

describe("WorkspaceProviderRegistry", () => {
  describe("register", () => {
    it("registers a provider and makes it retrievable", () => {
      const registry = new WorkspaceProviderRegistry();
      const provider = new FakeProvider("test");
      registry.register("test", provider);
      expect(registry.get("test")).toBe(provider);
    });

    it("returns this for chaining", () => {
      const registry = new WorkspaceProviderRegistry();
      const result = registry.register("a", new FakeProvider("a"));
      expect(result).toBe(registry);
    });

    it("throws when registering a duplicate name", () => {
      const registry = new WorkspaceProviderRegistry();
      registry.register("dup", new FakeProvider("dup"));
      expect(() => registry.register("dup", new FakeProvider("dup2"))).toThrow(
        "Workspace provider already registered",
      );
    });
  });

  describe("get", () => {
    it("returns undefined for an unregistered name", () => {
      const registry = new WorkspaceProviderRegistry();
      expect(registry.get("nonexistent")).toBeUndefined();
    });

    it("returns the provider for a registered name", () => {
      const registry = new WorkspaceProviderRegistry();
      const provider = new FakeProvider("gi");
      registry.register("git-worktree", provider);
      expect(registry.get("git-worktree")).toBe(provider);
    });
  });

  describe("has", () => {
    it("returns true for a registered name", () => {
      const registry = new WorkspaceProviderRegistry();
      registry.register("cd", new FakeProvider("cd"));
      expect(registry.has("cd")).toBe(true);
    });

    it("returns false for an unregistered name", () => {
      const registry = new WorkspaceProviderRegistry();
      expect(registry.has("cd")).toBe(false);
    });
  });

  describe("names", () => {
    it("returns an empty set when nothing is registered", () => {
      const registry = new WorkspaceProviderRegistry();
      expect(registry.names().size).toBe(0);
    });

    it("returns all registered provider names", () => {
      const registry = new WorkspaceProviderRegistry();
      registry.register("git-worktree", new FakeProvider("g"));
      registry.register("current-dir", new FakeProvider("c"));
      expect(registry.names()).toEqual(new Set(["git-worktree", "current-dir"]));
    });

    it("returns a snapshot (adding later does not mutate the returned set)", () => {
      const registry = new WorkspaceProviderRegistry();
      registry.register("a", new FakeProvider("a"));
      const names = registry.names();
      registry.register("b", new FakeProvider("b"));
      expect(names.size).toBe(1);
    });
  });
});
