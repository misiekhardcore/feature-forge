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
  tools?: string[];
}

/**
 * Loads an orchestrator persona from a markdown file and mounts it into the
 * main pi conversation.
 *
 * The orchestrator markdown file uses YAML frontmatter to declare metadata
 * (e.g. `tools`) and a plain-text body for the persona/system prompt.
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
    readonly systemPrompt: string,
    /** Active tools declared in the frontmatter. */
    readonly tools: string[] | undefined,
    /** The resolved prompt template from flow.orchestrator.task. */
    private readonly prompt: string,
  ) {}

  /**
   * Send the persona + resolved task as a user message and set active tools.
   *
   * @param pi — The pi ExtensionAPI instance.
   * @param context — The flow execution context for template resolution.
   */
  mount(pi: ExtensionAPI, context: FlowContext): void {
    const resolved = context.resolve(this.prompt);

    pi.on("before_agent_start", (event) => {
      return {
        systemPrompt:
          event.systemPrompt + "\n\n---\n\n## Custom system prompt\n\n" + this.systemPrompt,
      };
    });
    // Send the persona + resolved task as a user message to trigger a turn
    pi.sendUserMessage(resolved);

    // Apply active tools if declared in the frontmatter, even if empty array
    if (this.tools) {
      pi.setActiveTools(this.tools);
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

    return new OrchestratorAgent(body.trim(), frontmatter.tools, flow.orchestrator.prompt ?? "");
  }
}
