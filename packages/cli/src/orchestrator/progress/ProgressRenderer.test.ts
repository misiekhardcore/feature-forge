import type {
  AgentToolResult,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import type { RoutineResult } from "../RoutineResult";
import type { DisplayContribution } from "./DisplayContribution";
import type { ThemeLike } from "./ProgressRenderer";
import { ProgressRenderer } from "./ProgressRenderer";

// ── Helpers ──────────────────────────────────────────────────

function makeTheme(): ThemeLike {
  return {
    fg: (_color: string, text: string) => text,
  };
}

const theme = makeTheme();

// ── Tests ────────────────────────────────────────────────────

describe("ProgressRenderer", () => {
  describe("statusIcon", () => {
    it("returns a success-coloured checkmark for done + passed", () => {
      const result = ProgressRenderer.statusIcon("done", theme, true);
      expect(result).toBe("✓");
    });

    it("returns an error-coloured cross for done + not passed", () => {
      const result = ProgressRenderer.statusIcon("done", theme, false);
      expect(result).toBe("✗");
    });

    it("returns a warning-coloured hourglass for started", () => {
      const result = ProgressRenderer.statusIcon("started", theme);
      expect(result).toBe("⏳");
    });

    it("returns an error-coloured cross for error", () => {
      const result = ProgressRenderer.statusIcon("error", theme);
      expect(result).toBe("✗");
    });

    it("returns a muted circle for unknown status", () => {
      const result = ProgressRenderer.statusIcon("unknown", theme);
      expect(result).toBe("○");
    });

    it("returns a muted circle for undefined status", () => {
      const result = ProgressRenderer.statusIcon(undefined, theme);
      expect(result).toBe("○");
    });

    it("returns an accent spinner for running", () => {
      const result = ProgressRenderer.statusIcon("running", theme);
      expect(result).toBe("⟳");
    });

    it("forwards colour name to theme.fg for running", () => {
      let capturedColor = "";
      const testTheme: ThemeLike = {
        fg: (color, text) => {
          capturedColor = color;
          return text;
        },
      };
      ProgressRenderer.statusIcon("running", testTheme);
      expect(capturedColor).toBe("accent");
    });
  });

  describe("buildResultSuffix", () => {
    it("returns 'failed' when details is undefined (aligns with default passed=false)", () => {
      expect(ProgressRenderer.buildResultSuffix(undefined)).toBe("failed");
    });

    it("returns label-prefixed suffix when label is present (highest priority)", () => {
      const details: RoutineResult = {
        routine: "test",
        passed: true,
        rounds: 0,
        results: {},
        summary: "done",
        session: {},
        label: "builder",
      };
      expect(ProgressRenderer.buildResultSuffix(details)).toBe("agent: builder");
    });

    it("returns agentId-prefixed suffix when label is absent but agentId is present", () => {
      const details: RoutineResult = {
        routine: "test",
        passed: true,
        rounds: 0,
        results: {},
        summary: "done",
        session: {},
        agentId: "agent-42",
      };
      expect(ProgressRenderer.buildResultSuffix(details)).toBe("agent: agent-42");
    });

    it("returns rounds string when rounds > 0 (priority over workspace/summary)", () => {
      const details: RoutineResult = {
        routine: "test",
        passed: true,
        rounds: 3,
        results: {},
        summary: "done",
        session: {},
        workspace: "/tmp/ws",
      };
      expect(ProgressRenderer.buildResultSuffix(details)).toBe("3 rounds");
    });

    it("uses singular 'round' for a single round", () => {
      const details: RoutineResult = {
        routine: "test",
        passed: true,
        rounds: 1,
        results: {},
        summary: "done",
        session: {},
      };
      expect(ProgressRenderer.buildResultSuffix(details)).toBe("1 round");
    });

    it("extracts PR URL from results.pr.raw when available (priority over workspace)", () => {
      const details: RoutineResult = {
        routine: "test",
        passed: true,
        rounds: 0,
        results: {
          pr: { raw: "https://github.com/owner/repo/pull/42" },
        },
        summary: "done",
        session: {},
        workspace: "/tmp/ws",
      };
      expect(ProgressRenderer.buildResultSuffix(details)).toBe(
        "https://github.com/owner/repo/pull/42",
      );
    });

    it("falls through pr.raw when pr is missing from results", () => {
      const details: RoutineResult = {
        routine: "test",
        passed: true,
        rounds: 0,
        results: {},
        summary: "done",
        session: {},
        workspace: "/tmp/ws",
      };
      expect(ProgressRenderer.buildResultSuffix(details)).toBe("ws: ws");
    });

    it("returns workspace suffix when workspace is present but no rounds/label/agentId/pr", () => {
      const details: RoutineResult = {
        routine: "test",
        passed: true,
        rounds: 0,
        results: {},
        summary: "done",
        session: {},
        workspace: "/home/user/projects/ws-my-worktree",
      };
      expect(ProgressRenderer.buildResultSuffix(details)).toBe("ws: ws-my-worktree");
    });

    it("extracts cleanup summary from results.cleanup.parsed.summary (priority over summary)", () => {
      const details: RoutineResult = {
        routine: "test",
        passed: true,
        rounds: 0,
        results: {
          cleanup: { raw: "", parsed: { passed: true, summary: "workspace released" } },
        },
        summary: "done",
        session: {},
      };
      expect(ProgressRenderer.buildResultSuffix(details)).toBe("workspace released");
    });

    it("shows cleanup summary for destroy_workspace-style result (rounds > 0 regression guard)", () => {
      // Regression: PR #115 added cleanup summary at step 6, but rounds was
      // always ≥1 in production (RoutineExecutor context.iteration + 1 bug)
      // so the cleanup path was unreachable for non-loop routines.
      const details: RoutineResult = {
        routine: "destroy_workspace",
        passed: true,
        rounds: 0,
        results: {
          cleanup: {
            raw: "",
            parsed: { passed: true, summary: "Cleanup completed: 1 workspace(s)" },
          },
        },
        summary: "done",
        session: {},
      };
      expect(ProgressRenderer.buildResultSuffix(details)).toBe("Cleanup completed: 1 workspace(s)");
    });

    it("shows workspace path for create_workspace-style result (rounds > 0 regression guard)", () => {
      // Regression: rounds was always ≥1, masking workspace display for
      // non-loop routines like create_workspace.
      const details: RoutineResult = {
        routine: "create_workspace",
        passed: true,
        rounds: 0,
        results: {},
        summary: "done",
        session: {},
        workspace: "/tmp/forge-ws",
      };
      expect(ProgressRenderer.buildResultSuffix(details)).toBe("ws: forge-ws");
    });

    it("falls through cleanup when parsed is missing", () => {
      const details: RoutineResult = {
        routine: "test",
        passed: true,
        rounds: 0,
        results: {
          cleanup: { raw: "cleaned up" },
        },
        summary: "generic summary",
        session: {},
      };
      expect(ProgressRenderer.buildResultSuffix(details)).toBe("generic summary");
    });

    it("falls through cleanup when results is empty", () => {
      const details: RoutineResult = {
        routine: "test",
        passed: true,
        rounds: 0,
        results: {},
        summary: "done",
        session: {},
      };
      expect(ProgressRenderer.buildResultSuffix(details)).toBe("done");
    });

    it("returns summary when no label, rounds, workspace, pr, or cleanup are available", () => {
      const details: RoutineResult = {
        routine: "test",
        passed: true,
        rounds: 0,
        results: {},
        summary: "all checks passed",
        session: {},
      };
      expect(ProgressRenderer.buildResultSuffix(details)).toBe("all checks passed");
    });

    it("returns 'passed' fallback when no details are present and result passed", () => {
      const details: RoutineResult = {
        routine: "test",
        passed: true,
        rounds: 0,
        results: {},
        summary: "",
        session: {},
      };
      expect(ProgressRenderer.buildResultSuffix(details)).toBe("passed");
    });

    it("returns 'failed' fallback when no details are present and result failed", () => {
      const details: RoutineResult = {
        routine: "test",
        passed: false,
        rounds: 0,
        results: {},
        summary: "",
        session: {},
      };
      expect(ProgressRenderer.buildResultSuffix(details)).toBe("failed");
    });

    it("prefers label over agentId when both are present", () => {
      const details: RoutineResult = {
        routine: "test",
        passed: true,
        rounds: 0,
        results: {},
        summary: "",
        session: {},
        label: "reviewer",
        agentId: "agent-42",
      };
      expect(ProgressRenderer.buildResultSuffix(details)).toBe("agent: reviewer");
    });
  });

  describe("formatAgentRow", () => {
    it("formats a row with icon and label", () => {
      const result = ProgressRenderer.formatAgentRow("✓", "builder");
      expect(result).toBe("  ✓ builder");
    });

    it("appends annotation after an em-dash", () => {
      const result = ProgressRenderer.formatAgentRow("⏳", "tester", "in progress");
      expect(result).toBe("  ⏳ tester — in progress");
    });
  });

  describe("buildWidgetLines", () => {
    it("uses statusIcon('running') in the header", () => {
      const lines = ProgressRenderer.buildWidgetLines({
        theme,
        title: "build",
        rows: [],
      });
      expect(lines[0]).toContain("⟳");
    });

    it("includes subtitle in header when provided", () => {
      const lines = ProgressRenderer.buildWidgetLines({
        theme,
        title: "build",
        subtitle: "iteration 2/3",
        rows: [],
      });
      expect(lines[0]).toContain("iteration 2/3");
    });

    it("shows 'no agents yet' when rows are empty", () => {
      const lines = ProgressRenderer.buildWidgetLines({
        theme,
        title: "build",
        rows: [],
      });
      expect(lines[2]).toContain("no agents yet");
    });

    it("includes metadata lines", () => {
      const lines = ProgressRenderer.buildWidgetLines({
        theme,
        title: "build",
        rows: [],
        metadata: ["while: true"],
      });
      expect(lines.some((l) => l.includes("while: true"))).toBe(true);
    });

    it("includes workspace path", () => {
      const lines = ProgressRenderer.buildWidgetLines({
        theme,
        title: "build",
        rows: [],
        path: "/tmp/ws",
      });
      expect(lines.some((l) => l.includes("ws: /tmp/ws"))).toBe(true);
    });

    it("renders rows in order", () => {
      const lines = ProgressRenderer.buildWidgetLines({
        theme,
        title: "build",
        rows: ["  ✓ builder", "  ✗ tester"],
      });
      expect(lines[2]).toBe("  ✓ builder");
      expect(lines[3]).toBe("  ✗ tester");
    });
  });

  describe("buildStatusLine", () => {
    it("uses statusIcon('running') at the start", () => {
      const text = ProgressRenderer.buildStatusLine({
        theme,
        title: "build",
        tags: [],
      });
      expect(text.startsWith("⟳")).toBe(true);
    });

    it("includes subtitle when provided", () => {
      const text = ProgressRenderer.buildStatusLine({
        theme,
        title: "build",
        subtitle: "2/3",
        tags: [],
      });
      expect(text).toContain("2/3");
    });

    it("joins tags with middle-dot separator", () => {
      const text = ProgressRenderer.buildStatusLine({
        theme,
        title: "build",
        tags: ["✓ builder", "⏳ tester"],
      });
      expect(text).toContain("✓ builder");
      expect(text).toContain("⏳ tester");
      expect(text).toContain("·");
    });
  });

  describe("buildAgentMap", () => {
    it("maps contributions by agent id", () => {
      const map = ProgressRenderer.buildAgentMap([
        { agentId: "a1", agentStatus: "done", agentPassed: true },
        { agentId: "a2", agentStatus: "started" },
      ]);
      expect(map.get("a1")?.status).toBe("done");
      expect(map.get("a1")?.passed).toBe(true);
      expect(map.get("a2")?.status).toBe("started");
      expect(map.size).toBe(2);
    });

    it("overwrites earlier contributions with later ones for same agent", () => {
      const map = ProgressRenderer.buildAgentMap([
        { agentId: "a1", agentStatus: "started" },
        { agentId: "a1", agentStatus: "done", agentPassed: true },
      ]);
      expect(map.get("a1")?.status).toBe("done");
      expect(map.get("a1")?.passed).toBe(true);
    });

    it("skips contributions without agentId or agentStatus", () => {
      const map = ProgressRenderer.buildAgentMap([
        { agentId: "a1", agentStatus: "done" },
        { phase: "loop-round" },
      ]);
      expect(map.size).toBe(1);
    });
  });

  describe("getIterationInfo", () => {
    it("returns zeros when no contributions have iterations", () => {
      const info = ProgressRenderer.getIterationInfo([]);
      expect(info).toEqual({ iteration: 0, maxIterations: 0 });
    });

    it("picks the latest iteration values", () => {
      const info = ProgressRenderer.getIterationInfo([
        { iteration: 0, maxIterations: 3 },
        { iteration: 1, maxIterations: 3 },
      ]);
      expect(info).toEqual({ iteration: 1, maxIterations: 3 });
    });
  });

  describe("getBranch", () => {
    it("returns undefined when no contributions have a branch", () => {
      expect(ProgressRenderer.getBranch([])).toBeUndefined();
    });

    it("returns the latest branch", () => {
      const branch = ProgressRenderer.getBranch([
        { branch: "forge/ws-abc" },
        { branch: "forge/ws-def" },
      ]);
      expect(branch).toBe("forge/ws-def");
    });
  });

  describe("getWorkspacePath", () => {
    it("returns undefined when no contributions have a workspace", () => {
      expect(ProgressRenderer.getWorkspacePath([])).toBeUndefined();
    });

    it("returns the latest workspace path", () => {
      const path = ProgressRenderer.getWorkspacePath([
        { workspace: "/tmp/ws-1" },
        { workspace: "/tmp/ws-2" },
      ]);
      expect(path).toBe("/tmp/ws-2");
    });
  });

  describe("getContinueWhile", () => {
    it("returns undefined when no contributions have continueWhile", () => {
      expect(ProgressRenderer.getContinueWhile([])).toBeUndefined();
    });

    it("returns the latest continueWhile expression", () => {
      const expr = ProgressRenderer.getContinueWhile([
        { continueWhile: "result.passed" },
        { continueWhile: "result.rounds < 5" },
      ]);
      expect(expr).toBe("result.rounds < 5");
    });
  });

  describe("buildResultComponent", () => {
    function makeRenderer(contributions: Partial<DisplayContribution>[] = []) {
      const state = {
        routineName: "test-routine",
        contributions: contributions.map((c) => ({
          agentId: "a1",
          agentStatus: "started",
          ...c,
        })),
      };
      return new ProgressRenderer(state);
    }

    it("renders running state with started icon in partial mode", () => {
      const renderer = makeRenderer();
      const result: AgentToolResult<RoutineResult> = {
        content: [],
        details: undefined as unknown as RoutineResult,
      };
      const options: ToolRenderResultOptions = { expanded: false, isPartial: true };
      const rendered = renderer.buildResultComponent(result, options, theme as unknown as Theme);
      const lines = rendered.render(80);
      expect(lines[0]).toContain("⏳");
      expect(lines[0]).toContain("test-routine");
      expect(lines[0]).toContain("running");
    });

    it("renders passed state with checkmark in final mode", () => {
      const renderer = makeRenderer();
      const result: AgentToolResult<RoutineResult> = {
        content: [],
        details: {
          routine: "test-routine",
          passed: true,
          rounds: 0,
          results: {},
          summary: "",
          session: {},
        },
      };
      const options: ToolRenderResultOptions = { expanded: true, isPartial: false };
      const rendered = renderer.buildResultComponent(result, options, theme as unknown as Theme);
      const lines = rendered.render(80);
      expect(lines[0]).toContain("✓");
      expect(lines[0]).toContain("test-routine");
      expect(lines[0]).toContain("passed");
    });

    it("renders failed state with cross when details are undefined in final mode", () => {
      const renderer = makeRenderer();
      const result: AgentToolResult<RoutineResult> = {
        content: [],
        details: undefined as unknown as RoutineResult,
      };
      const options: ToolRenderResultOptions = { expanded: true, isPartial: false };
      const rendered = renderer.buildResultComponent(result, options, theme as unknown as Theme);
      const lines = rendered.render(80);
      expect(lines[0]).toContain("✗");
      expect(lines[0]).toContain("test-routine");
      expect(lines[0]).toContain("failed");
    });
  });
});
