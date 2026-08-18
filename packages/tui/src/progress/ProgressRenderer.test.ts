import type {
  AgentToolResult,
  Theme,
  ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

import { createAccumulatedState } from "./AccumulatedState";
import type { DisplayContribution } from "./DisplayContribution";
import { DisplayContributionRegistry } from "./DisplayContributionRegistry";
import { ProgressRenderer } from "./ProgressRenderer";
import type { RoutineProgressState } from "./RoutineProgressState";

// Local result shape matching RoutineResultLike used by ProgressRenderer.
interface TestResult {
  passed?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────

function makeTheme(): Theme {
  return {
    fg: (_color: string, text: string) => text,
  } as Theme;
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
      const testTheme = {
        fg: (color, text) => {
          capturedColor = color;
          return text;
        },
      } as Theme;
      ProgressRenderer.statusIcon("running", testTheme);
      expect(capturedColor).toBe("accent");
    });
  });

  describe("buildResultSuffix", () => {
    function makeAcc(snippet?: string) {
      const acc = createAccumulatedState();
      acc.resultSnippet = snippet;
      return acc;
    }

    it("returns the accumulated resultSnippet when present (wins over failed details)", () => {
      expect(ProgressRenderer.buildResultSuffix(makeAcc("ws: forge-ws"), { passed: false })).toBe(
        "ws: forge-ws",
      );
    });

    it("returns the accumulated resultSnippet when present (wins over passed details)", () => {
      expect(ProgressRenderer.buildResultSuffix(makeAcc("pr: #42"), { passed: true })).toBe(
        "pr: #42",
      );
    });

    it("falls back to 'passed' when no snippet and result passed", () => {
      expect(ProgressRenderer.buildResultSuffix(makeAcc(), { passed: true })).toBe("passed");
    });

    it("falls back to 'failed' when no snippet and result failed", () => {
      expect(ProgressRenderer.buildResultSuffix(makeAcc(), { passed: false })).toBe("failed");
    });

    it("falls back to 'failed' when no snippet and details is undefined", () => {
      expect(ProgressRenderer.buildResultSuffix(makeAcc(), undefined)).toBe("failed");
    });
  });

  describe("formatAgentRow", () => {
    it("formats a row with icon and label", () => {
      const result = ProgressRenderer.formatAgentRow("✓", "builder");
      expect(result).toBe("  ✓ builder");
    });

    it("appends annotation after a hyphen", () => {
      const result = ProgressRenderer.formatAgentRow("→", "tester", "in progress");
      expect(result).toBe("  → tester - in progress");
    });
  });

  describe("normalizeAgentAnnotation", () => {
    it("returns undefined for undefined input", () => {
      expect(ProgressRenderer.normalizeAgentAnnotation(undefined)).toBeUndefined();
    });

    it("returns undefined for empty input", () => {
      expect(ProgressRenderer.normalizeAgentAnnotation("")).toBeUndefined();
    });

    it("returns undefined for whitespace-only input", () => {
      expect(ProgressRenderer.normalizeAgentAnnotation(" \n\t ")).toBeUndefined();
    });

    it("collapses multi-line and multi-space summaries into a single line", () => {
      const result = ProgressRenderer.normalizeAgentAnnotation(
        "line one\n\nline two    with  spaces",
      );
      expect(result).toBe("line one line two with spaces");
      expect(result).not.toContain("\n");
    });

    it("trims leading and trailing whitespace", () => {
      const result = ProgressRenderer.normalizeAgentAnnotation("  padded  ");
      expect(result).toBe("padded");
    });

    it("keeps long summaries intact without truncation", () => {
      const summary = "x".repeat(130);
      expect(ProgressRenderer.normalizeAgentAnnotation(summary)).toBe(summary);
    });

    it("keeps wide-char summaries intact without truncation", () => {
      // 61 CJK chars = 122 visible columns: width truncation happens at
      // render time, not here.
      const wide = "中".repeat(61);
      expect(ProgressRenderer.normalizeAgentAnnotation(wide)).toBe(wide);
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

    it("separator width includes the icon and matches the header", () => {
      const lines = ProgressRenderer.buildWidgetLines({
        theme,
        title: "build",
        subtitle: "iteration 2/3",
        rows: [],
      });
      expect(visibleWidth(lines[1])).toBe(visibleWidth(lines[0]));
    });

    it("separator width matches the header without a subtitle", () => {
      const lines = ProgressRenderer.buildWidgetLines({
        theme,
        title: "build",
        rows: [],
      });
      expect(visibleWidth(lines[1])).toBe(visibleWidth(lines[0]));
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
      const result: AgentToolResult<TestResult> = {
        content: [],
        details: undefined as unknown as TestResult,
      };
      const options: ToolRenderResultOptions = { expanded: false, isPartial: true };
      const rendered = renderer.buildResultComponent(result, options, theme);
      const lines = rendered.render(80);
      expect(lines[0]).toContain("⟳");
      expect(lines[0]).toContain("test-routine");
      expect(lines[0]).toContain("running");
    });

    it("renders passed state with checkmark in final mode", () => {
      const renderer = makeRenderer();
      const result: AgentToolResult<TestResult> = {
        content: [],
        details: { passed: true },
      };
      const options: ToolRenderResultOptions = { expanded: true, isPartial: false };
      const rendered = renderer.buildResultComponent(result, options, theme);
      const lines = rendered.render(80);
      expect(lines[0]).toContain("✓");
      expect(lines[0]).toContain("test-routine");
      expect(lines[0]).toContain("passed");
    });

    it("renders failed state with cross when details are undefined in final mode", () => {
      const renderer = makeRenderer();
      const result: AgentToolResult<TestResult> = {
        content: [],
        details: undefined as unknown as TestResult,
      };
      const options: ToolRenderResultOptions = { expanded: true, isPartial: false };
      const rendered = renderer.buildResultComponent(result, options, theme);
      const lines = rendered.render(80);
      expect(lines[0]).toContain("✗");
      expect(lines[0]).toContain("test-routine");
      expect(lines[0]).toContain("failed");
    });

    it("uses resultSnippet from accumulated state instead of buildResultSuffix", () => {
      const registry = new DisplayContributionRegistry();
      registry.register("session", (state, contribution) => {
        if (contribution.type === "session") {
          const entries = Object.entries(contribution.params);
          state.resultSnippet = entries.map(([k, v]) => `${k}: ${v}`).join(", ");
        }
      });

      const state: RoutineProgressState = {
        routineName: "test-routine",
        contributions: [
          {
            type: "session",
            params: { ws: "/tmp/forge-ws", branch: "forge/ws-abc" },
            phase: "session-set",
            message: "Session param set",
          },
        ],
      };
      const renderer = new ProgressRenderer(state, registry);

      const result: AgentToolResult<TestResult> = {
        content: [],
        details: { passed: true },
      };
      const options: ToolRenderResultOptions = { expanded: true, isPartial: false };
      const rendered = renderer.buildResultComponent(result, options, theme);
      const lines = rendered.render(80);
      expect(lines[0]).toContain("✓");
      expect(lines[0]).toContain("test-routine");
      expect(lines[0]).toContain("ws: /tmp/forge-ws, branch: forge/ws-abc");
      expect(lines[0]).not.toContain("passed");
    });

    it("falls back to buildResultSuffix when accumulated state has no resultSnippet", () => {
      const registry = new DisplayContributionRegistry();
      const state: RoutineProgressState = {
        routineName: "test-routine",
        contributions: [],
      };
      const renderer = new ProgressRenderer(state, registry);

      const result: AgentToolResult<TestResult> = {
        content: [],
        details: { passed: true },
      };
      const options: ToolRenderResultOptions = { expanded: true, isPartial: false };
      const rendered = renderer.buildResultComponent(result, options, theme);
      const lines = rendered.render(80);
      expect(lines[0]).toContain("✓");
      expect(lines[0]).toContain("test-routine");
      expect(lines[0]).toContain("passed");
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
      const component = renderer.buildCallComponent(theme);
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
      const component = renderer.buildCallComponent(theme);
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
      const component = renderer.buildCallComponent(theme);
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

    it("collapses long multi-line summaries into a single full-text row", () => {
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

      const longText = "x".repeat(150);
      const contributions: DisplayContribution[] = [
        {
          type: "agent",
          agentId: "builder",
          agentStatus: "done",
          agentPassed: true,
          agentSummary: "line one\n\nline two    with  spaces " + longText,
          phase: "agent-done",
          message: "completed",
        },
      ];

      const state: RoutineProgressState = {
        routineName: "my-routine",
        contributions,
      };
      const renderer = new ProgressRenderer(state, registry);
      const widget = makeMockWidget();

      renderer.renderToWidget(widget, theme);

      const [lines] = widget.render.mock.calls[0];
      const row = (lines as string[]).find((l) => l.includes("builder"));
      expect(row).toBeDefined();
      const rowText = row ?? "";
      expect(rowText).not.toContain("\n");
      expect(rowText).toContain("line one line two with spaces");
      // Full collapsed text is kept — no truncation or ellipsis at row build time.
      expect(rowText).toContain(longText);
      expect(rowText).not.toContain("…");
    });

    it("renders rows without annotation when an agent has no summary", () => {
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

      const contributions: DisplayContribution[] = [
        {
          type: "agent",
          agentId: "builder",
          agentStatus: "done",
          agentPassed: true,
          phase: "agent-done",
          message: "completed",
        },
      ];

      const state: RoutineProgressState = {
        routineName: "my-routine",
        contributions,
      };
      const renderer = new ProgressRenderer(state, registry);
      const widget = makeMockWidget();

      renderer.renderToWidget(widget, theme);

      const [lines] = widget.render.mock.calls[0];
      const row = (lines as string[]).find((l) => l.includes("builder"));
      expect(row).toBe("  ✓ builder");
      expect(row).not.toContain(" — ");
    });
  });
});
