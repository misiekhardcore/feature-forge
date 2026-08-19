import { makeMockPi, makeMockSpecManager } from "@feature-forge/cli/src/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ParentSocketServer } from "./ParentSocketServer";

const { mockCreateServer } = vi.hoisted(() => ({
  mockCreateServer: vi.fn(),
}));

vi.mock("node:net", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:net")>();
  return { ...actual, createServer: mockCreateServer };
});

describe("ParentSocketServer error paths", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects when the underlying server emits an error before listening", async () => {
    let errorHandler: ((error: Error) => void) | undefined;
    mockCreateServer.mockReturnValue({
      on: vi.fn((event: string, handler: (error: Error) => void) => {
        if (event === "error") errorHandler = handler;
      }),
      listen: vi.fn(),
      close: vi.fn((cb: () => void) => cb()),
    });

    const server = new ParentSocketServer({} as never, makeMockPi(), makeMockSpecManager());
    const startPromise = server.start();

    errorHandler!(new Error("EADDRINUSE"));

    await expect(startPromise).rejects.toThrow("EADDRINUSE");
  });
});
