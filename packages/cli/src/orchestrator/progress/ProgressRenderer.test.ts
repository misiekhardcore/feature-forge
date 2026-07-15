import type {
  AgentToolResult,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

import type { RoutineResult } from "../RoutineResult";
import type { DisplayContribution } from "./DisplayContribution";
import { DisplayContributionRegistry } from "./DisplayContributionRegistry";
import type { ThemeLike } from "./ProgressRenderer";
import { ProgressRenderer } from "./ProgressRenderer";
import type { RoutineProgressState } from "./RoutineProgressState";

// ── Helpers ──────────────────────────────────────────────────

function makeTheme(): ThemeLike {
  return {
    fg: (_color: string, text: string) => text,
  };
}

const theme = makeTheme();

/** Minimal mock widget for renderToWidget tests. */
function makeMockWidget() {
  return { render: vi.fn(), clear: vi.fn() };
}

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
      expect(result).toBe("⟳");
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
      const result = ProgressRenderer.formatAgentRow("→", "tester", "in progress");
      expect(result).toBe("  → tester — in progress");
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
        tags: ["✓ builder", "→ tester"],
      });
      expect(text).toContain("✓ builder");
      expect(text).toContain("→ tester");
      expect(text).toContain("·");
    });
  });

  describe("buildResultComponent", () => {
    function makeRenderer() {
      const state: RoutineProgressState = {
        routineName: "test-routine",
        contributions: [],
      };
      return new ProgressRenderer(state, new DisplayContributionRegistry());
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
      expect(lines[0]).toContain("⟳");
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

  describe("buildCallComponent", () => {
    it("renders routine name with pending state when no agents", () => {
      const registry = new DisplayContributionRegistry();
      const state: RoutineProgressState = {
        routineName: "build-routine",
        contributions: [],
      };
      const renderer = new ProgressRenderer(state, registry);
      const component = renderer.buildCallComponent(theme as unknown as Theme);
      const lines = component.render(80);
      expect(lines[0]).toContain("⟳");
      expect(lines[0]).toContain("build-routine");
      expect(lines[0]).toContain("pending");
    });

    it("renders with agent count from registry", () => {
      const registry = new DisplayContributionRegistry();
      registry.register("agent", (state, contribution) => {
        if (contribution.type === "agent" && contribution.agentId && contribution.agentStatus) {
          state.agentMap.set(contribution.agentId, { status: contribution.agentStatus });
        }
      });
      registry.register("loop", (state, contribution) => {
        if (contribution.type === "loop") {
          state.iteration = contribution.iteration;
          state.maxIterations = contribution.maxIterations;
        }
      });

      const contributions: DisplayContribution[] = [
        {
          type: "agent",
          agentId: "builder",
          agentStatus: "started",
          phase: "agent-started",
          message: "started",
        },
        {
          type: "agent",
          agentId: "tester",
          agentStatus: "done",
          agentPassed: true,
          agentSummary: "All passed",
          phase: "agent-done",
          message: "completed",
        },
        {
          type: "loop",
          iteration: 0,
          maxIterations: 3,
          phase: "loop-round-start",
          message: "round 1",
        },
      ];

      const state: RoutineProgressState = {
        routineName: "build-routine",
        contributions,
      };
      const renderer = new ProgressRenderer(state, registry);
      const component = renderer.buildCallComponent(theme as unknown as Theme);
      const lines = component.render(80);
      expect(lines[0]).toContain("⟳");
      expect(lines[0]).toContain("build-routine");
      expect(lines[0]).toContain("1/3");
      expect(lines[0]).toContain("2 agents");
    });

    it("renders with no iteration info when no loop contributions", () => {
      const registry = new DisplayContributionRegistry();
      registry.register("agent", (state, contribution) => {
        if (contribution.type === "agent" && contribution.agentId && contribution.agentStatus) {
          state.agentMap.set(contribution.agentId, { status: contribution.agentStatus });
        }
      });
      const contributions: DisplayContribution[] = [
        {
          type: "agent",
          agentId: "builder",
          agentStatus: "started",
          phase: "agent-started",
          message: "started",
        },
      ];
      const state: RoutineProgressState = {
        routineName: "build-routine",
        contributions,
      };
      const renderer = new ProgressRenderer(state, registry);
      const component = renderer.buildCallComponent(theme as unknown as Theme);
      const lines = component.render(80);
      expect(lines[0]).toContain("⟳");
      expect(lines[0]).toContain("build-routine");
      expect(lines[0]).toContain("1 agent");
      expect(lines[0]).not.toContain("/");
    });
  });

  describe("renderToWidget", () => {
    it("renders to widget with correct lines and status text", () => {
      const registry = new DisplayContributionRegistry();
      registry.register("agent", (state, contribution) => {
        if (contribution.type === "agent" && contribution.agentId && contribution.agentStatus) {
          state.agentMap.set(contribution.agentId, {
            status: contribution.agentStatus,
            summary: contribution.agentSummary,
            passed: contribution.agentPassed,
          });
        }
      });
      registry.register("loop", (state, contribution) => {
        if (contribution.type === "loop") {
          state.iteration = contribution.iteration;
          state.maxIterations = contribution.maxIterations;
        }
      });
      registry.register("workspace", (state, contribution) => {
        if (contribution.type === "workspace") {
          state.workspace = contribution.workspace;
          state.branch = contribution.branch;
        }
      });

      const contributions: DisplayContribution[] = [
        {
          type: "workspace",
          workspace: "/tmp/my-ws",
          branch: "forge/ws-abc",
          phase: "workspace-ready",
          message: "ready",
        },
        {
          type: "agent",
          agentId: "builder",
          agentStatus: "started",
          phase: "agent-started",
          message: "started",
        },
        {
          type: "agent",
          agentId: "tester",
          agentStatus: "done",
          agentPassed: true,
          agentSummary: "All tests passed",
          phase: "agent-done",
          message: "completed",
        },
        {
          type: "loop",
          iteration: 1,
          maxIterations: 3,
          phase: "loop-round-start",
          message: "round 2",
        },
      ];

      const state: RoutineProgressState = {
        routineName: "my-routine",
        contributions,
      };
      const renderer = new ProgressRenderer(state, registry);
      const widget = makeMockWidget();

      renderer.renderToWidget(widget, theme);

      expect(widget.render).toHaveBeenCalledTimes(1);
      const [lines, statusText] = widget.render.mock.calls[0];

      // Widget lines
      expect(lines[0]).toContain("⟳");
      expect(lines[0]).toContain("my-routine");
      expect(lines[0]).toContain("iteration 2/3");

      // Agent rows
      const joinedLines = (lines as string[]).join("\n");
      expect(joinedLines).toContain("builder");
      expect(joinedLines).toContain("tester");
      expect(joinedLines).toContain("All tests passed");

      // Workspace path
      expect(joinedLines).toContain("/tmp/my-ws");
      expect(joinedLines).toContain("forge/ws-abc");

      // Status text
      expect(statusText).toContain("⟳");
      expect(statusText).toContain("my-routine");
      expect(statusText).toContain("2/3");
      expect(statusText).toContain("builder");
      expect(statusText).toContain("tester");
    });

    it("renders empty state when no contributions", () => {
      const registry = new DisplayContributionRegistry();
      const state: RoutineProgressState = {
        routineName: "empty-routine",
        contributions: [],
      };
      const renderer = new ProgressRenderer(state, registry);
      const widget = makeMockWidget();

      renderer.renderToWidget(widget, theme);

      expect(widget.render).toHaveBeenCalledTimes(1);
      const [lines, statusText] = widget.render.mock.calls[0];
      const joinedLines = (lines as string[]).join("\n");
      expect(joinedLines).toContain("no agents yet");
      expect(statusText).toBe("⟳ empty-routine");
    });

    it("includes continueWhile in metadata when present", () => {
      const registry = new DisplayContributionRegistry();
      registry.register("loop", (state, contribution) => {
        if (contribution.type === "loop") {
          state.iteration = contribution.iteration;
          state.maxIterations = contribution.maxIterations;
          state.continueWhile = contribution.continueWhile;
        }
      });

      const contributions: DisplayContribution[] = [
        {
          type: "loop",
          iteration: 0,
          maxIterations: 5,
          continueWhile: "result.passed",
          phase: "loop-round-start",
          message: "round",
        },
      ];

      const state: RoutineProgressState = {
        routineName: "loop-routine",
        contributions,
      };
      const renderer = new ProgressRenderer(state, registry);
      const widget = makeMockWidget();

      renderer.renderToWidget(widget, theme);

      const [lines] = widget.render.mock.calls[0];
      const joinedLines = (lines as string[]).join("\n");
      expect(joinedLines).toContain("while: result.passed");
    });
  });
});
