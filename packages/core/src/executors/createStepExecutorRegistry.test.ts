import { MockWorkspaceProvider } from "@feature-forge/core/test-utils";
import { describe, expect, it } from "vitest";

import { InMemoryAgentSupervisor } from "../agents/supervisors";
import { WorkspaceManager, WorkspaceProviderRegistry, WorktreeRegistry } from "../workspace";
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

  const workspaceManager = new WorkspaceManager(new MockWorkspaceProvider(), worktreeRegistry);

  return { workspaceProviderRegistry, supervisor, specManager, worktreeRegistry, workspaceManager };
}

// ── Tests ────────────────────────────────────────────────────

describe("createStepExecutorRegistry", () => {
  it("returns a StepExecutorRegistry", () => {
    const {
      workspaceProviderRegistry,
      supervisor,
      specManager,
      worktreeRegistry,
      workspaceManager,
    } = setup();
    const registry = createStepExecutorRegistry(
      workspaceProviderRegistry,
      supervisor,
      specManager,
      worktreeRegistry,
      workspaceManager,
    );

    expect(registry).toBeDefined();
    expect(typeof registry.get).toBe("function");
  });

  it("registers all 7 built-in executors", () => {
    const {
      workspaceProviderRegistry,
      supervisor,
      specManager,
      worktreeRegistry,
      workspaceManager,
    } = setup();
    const registry = createStepExecutorRegistry(
      workspaceProviderRegistry,
      supervisor,
      specManager,
      worktreeRegistry,
      workspaceManager,
    );

    expect(registry.types().size).toBe(9);
  });

  it("registers leaf executors with correct types", () => {
    const {
      workspaceProviderRegistry,
      supervisor,
      specManager,
      worktreeRegistry,
      workspaceManager,
    } = setup();
    const registry = createStepExecutorRegistry(
      workspaceProviderRegistry,
      supervisor,
      specManager,
      worktreeRegistry,
      workspaceManager,
    );

    expect(registry.has("workspace")).toBe(true);
    expect(registry.has("agent")).toBe(true);
    expect(registry.has("cleanup")).toBe(true);
    expect(registry.has("git")).toBe(true);
    expect(registry.has("shell")).toBe(true);
  });

  it("registers container executors with correct types", () => {
    const {
      workspaceProviderRegistry,
      supervisor,
      specManager,
      worktreeRegistry,
      workspaceManager,
    } = setup();
    const registry = createStepExecutorRegistry(
      workspaceProviderRegistry,
      supervisor,
      specManager,
      worktreeRegistry,
      workspaceManager,
    );

    expect(registry.has("parallel")).toBe(true);
    expect(registry.has("loop")).toBe(true);
  });

  it("makes all executors retrievable by type", () => {
    const {
      workspaceProviderRegistry,
      supervisor,
      specManager,
      worktreeRegistry,
      workspaceManager,
    } = setup();
    const registry = createStepExecutorRegistry(
      workspaceProviderRegistry,
      supervisor,
      specManager,
      worktreeRegistry,
      workspaceManager,
    );

    for (const type of registry.types()) {
      expect(registry.get(type)).toBeDefined();
    }
  });

  it("registers container executors after leaf executors", () => {
    const {
      workspaceProviderRegistry,
      supervisor,
      specManager,
      worktreeRegistry,
      workspaceManager,
    } = setup();
    const registry = createStepExecutorRegistry(
      workspaceProviderRegistry,
      supervisor,
      specManager,
      worktreeRegistry,
      workspaceManager,
    );

    // All leaf types must be present when container executors are used
    const leafTypes = ["workspace", "agent", "cleanup", "git", "shell"];
    for (const leafType of leafTypes) {
      expect(registry.has(leafType)).toBe(true);
    }
    // Container types registered as well
    expect(registry.has("parallel")).toBe(true);
    expect(registry.has("loop")).toBe(true);
  });
});
