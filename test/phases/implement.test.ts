import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const { mockRun } = vi.hoisted(() => ({ mockRun: vi.fn() }));

vi.mock("../../.pi/extensions/feature-forge/pi-spawner", () => ({
  PiSpawner: class {
    run = vi.fn();
  },
}));

vi.mock("../../.pi/extensions/feature-forge/phases/implement/coordinator", () => ({
  ImplementCoordinator: class {
    run = mockRun;
  },
}));

import { ImplementPhase } from "../../.pi/extensions/feature-forge/phases/implement";
import { State } from "../../.pi/extensions/feature-forge/state";

describe("ImplementPhase", () => {
  let mockPi: ExtensionAPI;

  beforeEach(() => {
    State.reset();
    vi.clearAllMocks();
    mockPi = {
      registerCommand: vi.fn(),
      sendUserMessage: vi.fn().mockResolvedValue(undefined),
      appendEntry: vi.fn(),
      on: vi.fn(),
    } as unknown as ExtensionAPI;
    State.initialize(mockPi);

    mockRun.mockResolvedValue({ prUrl: undefined });
  });

  it("has the correct name and description", () => {
    const phase = new ImplementPhase(mockPi);
    expect(phase.name).toBe("implement");
    expect(phase.description).toMatch(/build, review, verify/i);
  });

  it("notifies error when no issue ref can be resolved", async () => {
    const notify = vi.fn();
    const phase = new ImplementPhase(mockPi);

    await phase.handler(undefined, {
      ui: { notify },
      sessionManager: { getEntries: () => [] },
    } as never);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("No issue found"), "error");
  });

  it("notifies error when whitespace-only args and no session state", async () => {
    const notify = vi.fn();
    const phase = new ImplementPhase(mockPi);

    await phase.handler("   ", {
      ui: { notify },
      sessionManager: { getEntries: () => [] },
    } as never);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("No issue found"), "error");
  });

  it("starts pipeline with notify when issue ref is resolved from args", async () => {
    const notify = vi.fn();
    const phase = new ImplementPhase(mockPi);

    await phase.handler("https://github.com/o/r/issues/42", {
      ui: { notify },
      sessionManager: { getEntries: () => [] },
    } as never);

    expect(notify).toHaveBeenCalledWith("Starting implementation pipeline...", "info");
    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it("starts pipeline with issue ref from pipeline state", async () => {
    const notify = vi.fn();
    const phase = new ImplementPhase(mockPi);

    await phase.handler(undefined, {
      ui: { notify },
      sessionManager: {
        getEntries: () => [
          {
            type: "custom",
            customType: "pipeline-issue",
            data: { issueUrl: "https://github.com/o/r/issues/7" },
            id: "e1",
            parentId: null,
            timestamp: new Date().toISOString(),
          },
        ],
      },
    } as never);

    expect(mockRun).toHaveBeenCalledTimes(1);
  });

  it("reports PR URL when coordinator returns one", async () => {
    mockRun.mockResolvedValue({ prUrl: "https://github.com/o/r/pull/99" });
    const notify = vi.fn();
    const phase = new ImplementPhase(mockPi);

    await phase.handler("https://github.com/o/r/issues/42", {
      ui: { notify },
      sessionManager: { getEntries: () => [] },
    } as never);

    expect(notify).toHaveBeenCalledWith("PR opened: https://github.com/o/r/pull/99", "info");
  });

  it("reports warning when no PR was created", async () => {
    mockRun.mockResolvedValue({ prUrl: undefined });
    const notify = vi.fn();
    const phase = new ImplementPhase(mockPi);

    await phase.handler("https://github.com/o/r/issues/42", {
      ui: { notify },
      sessionManager: { getEntries: () => [] },
    } as never);

    expect(notify).toHaveBeenCalledWith(
      "Implementation pipeline finished but no PR was created.",
      "warning",
    );
  });

  it("handles null sessionManager gracefully", async () => {
    const notify = vi.fn();
    const phase = new ImplementPhase(mockPi);

    await phase.handler("https://github.com/o/r/issues/42", {
      ui: { notify },
      sessionManager: null,
    } as never);

    expect(mockRun).toHaveBeenCalledTimes(1);
  });
});
