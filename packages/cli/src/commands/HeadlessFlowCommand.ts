import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import type { AgentSupervisor } from "../agents";
import type { FlowDefinition } from "../orchestrator/FlowInstruction";
import type { RoutineExecutor } from "../orchestrator/RoutineExecutor";
import { ToolRegistry } from "../registry/ToolRegistry";
import { Command } from "./Command";

/**
 * Command for flows that have no orchestrator persona.
 *
 * Instead of mounting an in-session LLM to drive routines, the handler
 * parses `key=value` (or `key="quoted value"`) params from the slash-command
 * args and runs the flow's single routine directly via {@link RoutineExecutor}.
 *
 * No LLM intermediary — the agent step inside the routine is spawned as a
 * subprocess and awaited.
 *
 * Usage: `/review workspace=/path/to/ws output="build results" prompt="review this"`
 */
export class HeadlessFlowCommand extends Command {
  readonly name: string;
  readonly description: string;

  constructor(
    private readonly flow: FlowDefinition,
    private readonly routineExecutor: RoutineExecutor,
    supervisor: AgentSupervisor,
    pi: import("@earendil-works/pi-coding-agent").ExtensionAPI,
    specManager: import("../agents/SpecManager").SpecManager,
    toolRegistry: ToolRegistry,
  ) {
    super(supervisor, pi, specManager, toolRegistry);
    this.name = flow.command.replace(/^\//, "");
    this.description = `Run the ${flow.name} workflow`;
  }

  async handler(args: string, ctx: ExtensionCommandContext): Promise<void> {
    const params = HeadlessFlowCommand.parseArgs(args);
    const routine = this.flow.routines[0];
    if (!routine) {
      ctx.ui.notify(`${this.flow.name} flow has no routines to run.`, "error");
      return;
    }

    const prompt = params["prompt"] ?? args.trim();

    ctx.ui.notify(`Running ${this.flow.name}...`, "info");

    try {
      const result = await this.routineExecutor.run(routine.id, params, prompt);

      if (result.passed) {
        ctx.ui.notify(`${this.flow.name} completed. ${result.summary}`, "info");
      } else {
        ctx.ui.notify(`${this.flow.name} failed: ${result.summary}`, "error");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`${this.flow.name} error: ${message}`, "error");
    }
  }

  /**
   * Parse `key=value` pairs from slash-command args.
   *
   * Supports:
   * - `key=value` — unquoted single-token values
   * - `key="value with spaces"` — double-quoted values
   *
   * Any text that doesn't match the pattern is silently ignored.
   */
  static parseArgs(args: string): Record<string, string> {
    const params: Record<string, string> = {};
    const regex = /(\w+)=("(?:[^"\\]|\\.)*"|\S+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(args)) !== null) {
      let value = match[2];
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1).replaceAll(/\\"/g, '"');
      }
      params[match[1]] = value;
    }
    return params;
  }
}
