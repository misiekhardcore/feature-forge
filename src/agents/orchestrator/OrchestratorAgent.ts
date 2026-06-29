import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

import type { FlowContext } from "../../orchestrator/FlowContext";
import type { FlowDefinition } from "../../orchestrator/FlowInstruction";

/**
 * Frontmatter shape extracted from an orchestrator markdown file.
 */
interface OrchestratorFrontmatter extends Record<string, unknown> {
  id?: string;
  role?: string;
  activeTools?: string[];
}

/**
 * Loads an orchestrator persona from a markdown file and mounts it into the
 * main pi conversation.
 *
 * The orchestrator markdown file uses YAML frontmatter to declare metadata
 * (e.g. `activeTools`) and a plain-text body for the persona/system prompt.
 * The task to execute is defined in `flow.json` → `orchestrator.task` and
 * resolved through the current {@link FlowContext}.
 *
 * ## Usage
 *
 * ```ts
 * const agent = await OrchestratorAgent.create(flow, flowDir);
 * await agent.mount(pi, context);
 * ```
 *
 * **Note:** `task` is not passed to `mount()`. The task template is stored from
 * `flow.orchestrator.task` during construction and resolved through the
 * {@link FlowContext} at mount time.
 */
export class OrchestratorAgent {
  private constructor(
    /** The persona/system prompt extracted from the orchestrator markdown body. */
    readonly persona: string,
    /** Active tools declared in the frontmatter. */
    readonly activeTools: string[] | undefined,
    /** The resolved task template from flow.orchestrator.task. */
    private readonly resolvedTask: string,
  ) {}

  /**
   * Send the persona + resolved task as a user message and set active tools.
   *
   * @param pi — The pi ExtensionAPI instance.
   * @param context — The flow execution context for template resolution.
   */
  mount(pi: ExtensionAPI, context: FlowContext): void {
    const resolved = context.resolve(this.resolvedTask);

    // Send the persona + resolved task as a user message to trigger a turn
    pi.sendUserMessage(`${this.persona}\n\n${resolved}`);

    // Apply active tools if declared in the frontmatter
    if (this.activeTools && this.activeTools.length > 0) {
      pi.setActiveTools(this.activeTools);
    }
  }

  /**
   * Create an OrchestratorAgent by reading and parsing the orchestrator
   * markdown file referenced by the flow definition.
   *
   * @param flow — The loaded flow definition.
   * @param flowDir — Directory containing the flow's JSON and markdown files.
   * @returns A ready-to-mount OrchestratorAgent.
   */
  static async create(flow: FlowDefinition, flowDir: string): Promise<OrchestratorAgent> {
    const filePath = path.join(flowDir, flow.orchestrator.systemPrompt);
    const content = await fs.readFile(filePath, "utf-8");

    const { frontmatter, body } = parseFrontmatter<OrchestratorFrontmatter>(content);

    return new OrchestratorAgent(
      body.trim(),
      frontmatter.activeTools,
      flow.orchestrator.task ?? "",
    );
  }
}
