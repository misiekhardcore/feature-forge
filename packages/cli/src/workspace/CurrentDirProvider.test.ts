import { describe, expect, it } from "vitest";

import { CurrentDirProvider } from "./CurrentDirProvider";

describe("CurrentDirProvider", () => {
  const provider = new CurrentDirProvider();

  describe("createWorkspace", () => {
    it("returns the current working directory", async () => {
      const path = await provider.createWorkspace("any-task-id");
      expect(path).toBe(process.cwd());
    });

    it("ignores the workspaceId parameter — always returns cwd", async () => {
      const pathA = await provider.createWorkspace("task-a");
      const pathB = await provider.createWorkspace("task-b");
      expect(pathA).toBe(pathB);
      expect(pathA).toBe(process.cwd());
    });
  });

  describe("destroyWorkspace", () => {
    it("does nothing and does not throw", async () => {
      await expect(provider.destroyWorkspace("/any/path")).resolves.toBeUndefined();
    });

    it("is safe to call multiple times", async () => {
      await provider.destroyWorkspace(process.cwd());
      await provider.destroyWorkspace(process.cwd());
      // No assertion needed — resolves without throwing
    });
  });
});
