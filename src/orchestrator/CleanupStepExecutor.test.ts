import { describe, expect, it, vi } from "vitest";

import { MockWorkspaceProvider, MockWorktreeRegistry } from "../test-utils";
import { WorkspaceManager } from "../workspace/WorkspaceManager";
import { CleanupStepExecutor } from "./CleanupStepExecutor";
import { FlowContext } from "./FlowContext";
import type { FlowInstruction } from "./FlowInstruction";

describe("CleanupStepExecutor", () => {
  describe("type", () => {
    it("returns 'cleanup'", () => {
      const provider = new MockWorkspaceProvider();
      const registry = new MockWorktreeRegistry();
      const manager = new WorkspaceManager(provider, registry);
      const executor = new CleanupStepExecutor(manager);
      expect(executor.type).toBe("cleanup");
    });
  });

  describe("execute", () => {
    it("destroys the workspace when workspaceId is set", async () => {
      const provider = new MockWorkspaceProvider();
      const destroySpy = vi.spyOn(provider, "destroyWorkspace");
      const registry = new MockWorktreeRegistry();
      const manager = new WorkspaceManager(provider, registry);

      // Pre-create workspace in the registry so destroy() works
      await manager.create("ws1");

      const executor = new CleanupStepExecutor(manager);

      const instruction: FlowInstruction = {
        type: "cleanup",
        id: "destroy",
      } as FlowInstruction;

      const context = new FlowContext(new Map(), "task", "", "/tmp/ws1", undefined, "ws1");

      await executor.execute(instruction, context, async () => context);

      expect(destroySpy).toHaveBeenCalledWith("/tmp/mock-workspaces/ws1");
    });

    it("does nothing when workspaceId is not set", async () => {
      const provider = new MockWorkspaceProvider();
      const destroySpy = vi.spyOn(provider, "destroyWorkspace");
      const registry = new MockWorktreeRegistry();
      const manager = new WorkspaceManager(provider, registry);

      const executor = new CleanupStepExecutor(manager);

      const instruction: FlowInstruction = {
        type: "cleanup",
        id: "destroy",
      } as FlowInstruction;

      const context = new FlowContext(new Map(), "task", "");

      await executor.execute(instruction, context, async () => context);

      expect(destroySpy).not.toHaveBeenCalled();
    });

    it("swallows errors during destroy (best-effort cleanup)", async () => {
      const provider = new MockWorkspaceProvider();
      provider.shouldFailDestruction = true;
      const registry = new MockWorktreeRegistry();
      const manager = new WorkspaceManager(provider, registry);

      // Create workspace so the id exists in registry for lookup
      await manager.create("ws1");

      const executor = new CleanupStepExecutor(manager);

      const instruction: FlowInstruction = {
        type: "cleanup",
        id: "destroy",
      } as FlowInstruction;

      const context = new FlowContext(new Map(), "task", "", "/tmp/ws1", undefined, "ws1");

      // Should not throw
      const result = await executor.execute(instruction, context, async () => context);
      expect(result).toBe(context);
    });
  });
});
