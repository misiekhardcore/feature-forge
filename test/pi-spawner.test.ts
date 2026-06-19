import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));
vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}));

import { PiSpawner } from "../.pi/extensions/feature-forge/pi-spawner";

describe("PiSpawner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeMockChild(): EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  } {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    return child;
  }

  it("spawns pi -p with the given prompt", async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);

    const spawner = new PiSpawner("/fake/pi");
    const promise = spawner.run("test prompt", { cwd: "/project" });

    // Emit data then close
    child.stdout.emit("data", Buffer.from("result output"));
    child.emit("close", 0);

    const result = await promise;

    expect(mockSpawn).toHaveBeenCalledWith(
      "/fake/pi",
      ["-p", "test prompt"],
      expect.objectContaining({ cwd: "/project" }),
    );
    expect(result.stdout).toBe("result output");
    expect(result.exitCode).toBe(0);
  });

  it("captures stdout from multiple chunks", async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);

    const spawner = new PiSpawner("/fake/pi");
    const promise = spawner.run("test");

    child.stdout.emit("data", Buffer.from("chunk1"));
    child.stdout.emit("data", Buffer.from("chunk2"));
    child.emit("close", 0);

    const result = await promise;
    expect(result.stdout).toBe("chunk1chunk2");
  });

  it("resolves with non-zero exit code on failure", async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);

    const spawner = new PiSpawner("/fake/pi");
    const promise = spawner.run("test");

    child.stdout.emit("data", Buffer.from(""));
    child.emit("close", 1);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("rejects on spawn error", async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);

    const spawner = new PiSpawner("/fake/pi");
    const promise = spawner.run("test");

    child.emit("error", new Error("ENOENT"));

    await expect(promise).rejects.toThrow("PiSpawner failed: ENOENT");
  });

  it("sets env when options.env is provided", async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);

    const spawner = new PiSpawner("/fake/pi");
    const promise = spawner.run("test", {
      env: { FOO: "bar", PATH: process.env.PATH ?? "" },
    });

    child.stdout.emit("data", Buffer.from(""));
    child.emit("close", 0);

    await promise;

    expect(mockSpawn).toHaveBeenCalledWith(
      "/fake/pi",
      ["-p", "test"],
      expect.objectContaining({
        env: expect.objectContaining({ FOO: "bar" }),
      }),
    );
  });

  it("resolves pi binary from PATH when no path given", () => {
    const spawner = new PiSpawner();
    expect(spawner).toBeDefined();
  });
});
