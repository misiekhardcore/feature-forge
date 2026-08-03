import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Value } from "typebox/value";

import type { AgentSupervisor } from "../agents";
import type { FlowDefinition, RoutineDefinition } from "../orchestrator/FlowInstruction";
import type { RoutineExecutor } from "../orchestrator/RoutineExecutor";
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
    pi: ExtensionAPI,
  ) {
    super(supervisor, pi);
    this.name = flow.command.replace(/^\//, "");
    this.description = `Run the ${flow.name} workflow`;
  }

  async handler(args: string, ctx: ExtensionCommandContext): Promise<void> {
    const routine = this.flow.routines[0];
    if (!routine) {
      ctx.ui.notify(`${this.flow.name} flow has no routines to run.`, "error");
      return;
    }

    const { params, prompt } = HeadlessFlowCommand.parseArgs(args, routine);

    // Validate against the routine's declared param schema.
    const schema = HeadlessFlowCommand.buildValidationSchema(routine);
    if (!Value.Check(schema, params)) {
      const errors = [...Value.Errors(schema, params)]
        .map((e) => `  ${(e as { instancePath?: string }).instancePath?.slice(1) || e.message}`)
        .join("\n");
      ctx.ui.notify(
        `Invalid params for ${this.flow.name}:\n${errors}\n\nExpected: ` +
          routine.params
            .map((p) => `${p.name}${p.optional !== true ? " (required)" : ""}`)
            .join(", "),
        "error",
      );
      return;
    }

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
   * Parse `key=value` pairs and free-text prompt from slash-command args.
   *
   * `key=value` tokens are extracted wherever they appear in the string;
   * the remaining text (with matched tokens stripped) becomes the prompt.
   * An explicit `prompt=...` token overrides the extracted free text.
   *
   * Order-independent — all of these produce the same result:
   * - `/review workspace=/ws review auth`
   * - `/review review auth workspace=/ws`
   * - `/review workspace=/ws prompt="review auth"`
   */
  static parseArgs(
    args: string,
    routine: RoutineDefinition,
  ): { params: Record<string, string>; prompt: string } {
    const params: Record<string, string> = {};
    const regex = /(\w+)=("(?:[^"\\]|\\.)*"|\S+)/g;
    const consumed: Array<{ start: number; end: number }> = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(args)) !== null) {
      let value = match[2];
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1).replaceAll(/\\"/g, '"');
      }
      params[match[1]] = value;
      consumed.push({ start: match.index, end: match.index + match[0].length });
    }

    // Build the prompt from text that wasn't consumed as key=value tokens.
    let prompt = "";
    let cursor = 0;
    for (const range of consumed.sort((a, b) => a.start - b.start)) {
      prompt += args.slice(cursor, range.start);
      cursor = range.end;
    }
    prompt += args.slice(cursor);
    prompt = prompt.replaceAll(/\s+/g, " ").trim();

    // An explicit prompt=... param overrides the extracted free text.
    if (params["prompt"]) {
      prompt = params["prompt"];
      delete params["prompt"];
    }

    // Apply defaults for missing optional params.
    for (const param of routine.params) {
      if (!(param.name in params) && param.default !== undefined) {
        params[param.name] = param.default;
      }
    }

    return { params, prompt };
  }

  /**
   * Build a TypeBox schema from the routine's declared params for validation.
   *
   * Each param becomes a `Type.String()` property. Params with `optional: true`
   * are wrapped in `Type.Optional()`. Unknown keys are rejected via
   * `additionalProperties: false`.
   */
  static buildValidationSchema(routine: RoutineDefinition): ReturnType<typeof Type.Object> {
    const properties: Record<string, ReturnType<typeof Type.String>> = {};
    for (const param of routine.params) {
      const schema = Type.String({ minLength: 1 });
      properties[param.name] = param.optional === true ? Type.Optional(schema) : schema;
    }
    return Type.Object(properties, { additionalProperties: false });
  }
}
