import { describe, expect, it } from "vitest";

import { InMemoryAgentSupervisor } from "../agents/supervisors";
import { MockWorkspaceProvider } from "../test-utils";
import { WorkspaceProviderRegistry, WorktreeRegistry } from "../workspace";
import { createStepExecutorRegistry } from "./createStepExecutorRegistry";

// ── Helpers ──────────────────────────────────────────────────

function setup() {
  const workspaceProviderRegistry = new WorkspaceProviderRegistry().register(
    "mock",
    new MockWorkspaceProvider(),
  );
  const worktreeRegistry = new WorktreeRegistry();
  const mockFactory = { create: async () => ({ id: "a" }) };
  const supervisor = new InMemoryAgentSupervisor(mockFactory as never);
  const specManager = { resolve: () => ({}) } as never;

  return { workspaceProviderRegistry, supervisor, specManager, worktreeRegistry };
}

// ── Tests ────────────────────────────────────────────────────

describe("createStepExecutorRegistry", () => {
  it("returns a StepExecutorRegistry", () => {
    const { workspaceProviderRegistry, supervisor, specManager, worktreeRegistry } = setup();
    const registry = createStepExecutorRegistry(
      workspaceProviderRegistry,
      supervisor,
      specManager,
      worktreeRegistry,
    );

    expect(registry).toBeDefined();
    expect(typeof registry.get).toBe("function");
  });

  it("registers all 9 built-in executors", () => {
    const { workspaceProviderRegistry, supervisor, specManager, worktreeRegistry } = setup();
    const registry = createStepExecutorRegistry(
      workspaceProviderRegistry,
      supervisor,
      specManager,
      worktreeRegistry,
    );

    expect(registry.types().size).toBe(9);
  });

  it("registers leaf executors with correct types", () => {
    const { workspaceProviderRegistry, supervisor, specManager, worktreeRegistry } = setup();
    const registry = createStepExecutorRegistry(
      workspaceProviderRegistry,
      supervisor,
      specManager,
      worktreeRegistry,
    );

    expect(registry.has("workspace")).toBe(true);
    expect(registry.has("agent")).toBe(true);
    expect(registry.has("cleanup")).toBe(true);
    expect(registry.has("git")).toBe(true);
    expect(registry.has("shell")).toBe(true);
    expect(registry.has("session")).toBe(true);
    expect(registry.has("routine")).toBe(true);
  });

  it("registers container executors with correct types", () => {
    const { workspaceProviderRegistry, supervisor, specManager, worktreeRegistry } = setup();
    const registry = createStepExecutorRegistry(
      workspaceProviderRegistry,
      supervisor,
      specManager,
      worktreeRegistry,
    );

    expect(registry.has("parallel")).toBe(true);
    expect(registry.has("loop")).toBe(true);
  });

  it("makes all executors retrievable by type", () => {
    const { workspaceProviderRegistry, supervisor, specManager, worktreeRegistry } = setup();
    const registry = createStepExecutorRegistry(
      workspaceProviderRegistry,
      supervisor,
      specManager,
      worktreeRegistry,
    );

    for (const type of registry.types()) {
      expect(registry.get(type)).toBeDefined();
    }
  });

  it("registers container executors after leaf executors", () => {
    const { workspaceProviderRegistry, supervisor, specManager, worktreeRegistry } = setup();
    const registry = createStepExecutorRegistry(
      workspaceProviderRegistry,
      supervisor,
      specManager,
      worktreeRegistry,
    );

    // All leaf types must be present when container executors are used
    const leafTypes = ["workspace", "agent", "cleanup", "git", "shell", "session", "routine"];
    for (const leafType of leafTypes) {
      expect(registry.has(leafType)).toBe(true);
    }
    // Container types registered as well
    expect(registry.has("parallel")).toBe(true);
    expect(registry.has("loop")).toBe(true);
  });
});
