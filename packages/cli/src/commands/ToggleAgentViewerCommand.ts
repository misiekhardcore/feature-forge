import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { AgentViewerOverlay } from "../orchestrator/progress/AgentViewerOverlay";
import { Command } from "./Command";

/**
 * Opens the AgentViewerOverlay with test data for interactive testing.
 *
 * Usage: /forge:agent-viewer
 *
 * The overlay shows three dummy agents (builder, review, verify) with
 * simulated stream events so you can verify keyboard navigation, detail
 * views, and Esc dismissal without running a full routine.
 */
export class ToggleAgentViewerCommand extends Command {
  readonly name = "agent-viewer";
  readonly description = "Open the agent viewer overlay for testing (Esc to close).";

  handler = async (_args: string, ctx: ExtensionCommandContext): Promise<void> => {
    if (!ctx.ui) {
      // No TUI available — cannot show overlay.
      return;
    }

    const streamDir = mkdtempSync(join(tmpdir(), "forge-test-streams-"));

    await ctx.ui.custom<void>(
      (tui, theme, _kb, done) => {
        const viewer = new AgentViewerOverlay(tui, theme, () => {
          try {
            rmSync(streamDir, { recursive: true, force: true });
          } catch {
            // Silent cleanup.
          }
          done();
        });
        viewer.setAgentExecutionId("test-run", streamDir);

        // Seed with test agents.
        viewer.update({ id: "builder", status: "started" });
        viewer.update({ id: "review", status: "started" });
        viewer.update({ id: "verify", status: "started" });

        // Simulate stream events.
        viewer.pushStreamEvent("builder", { type: "tool_use", tool: "read", path: "src/foo.ts" });
        viewer.pushStreamEvent("builder", { type: "tool_result", content: "export const x = 1;" });
        viewer.pushStreamEvent("builder", { type: "message_delta", text_delta: "I'll read the file first..." });
        viewer.pushStreamEvent("review", { type: "tool_use", tool: "grep", pattern: "TODO" });
        viewer.pushStreamEvent("review", { type: "message_delta", text_delta: "Checking for TODOs..." });
        viewer.pushStreamEvent("verify", { type: "message_delta", text_delta: "Running tests..." });

        return viewer;
      },
      {
        overlay: true,
        overlayOptions: {
          anchor: "bottom-center",
          width: 80,
          maxHeight: 20,
          margin: { bottom: 1 },
        },
      },
    );

    // Overlay dismissed.
  };
}
