import * as fs from "node:fs/promises";
import * as path from "node:path";

import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

import type { FlowDefinition } from "../../orchestrator/FlowInstruction";
import type { AgentSpecification } from "../specifications";
import { DynamicAgentSpecification } from "../specifications";

/**
 * Frontmatter shape extracted from an orchestrator markdown file.
 */
interface OrchestratorFrontmatter extends Record<string, unknown> {
  id?: string;
  role?: string;
  tools?: string[];
}

/** Default role when frontmatter does not declare one. */
const DEFAULT_ROLE = "orchestrator";

/**
 * Loads an orchestrator persona from a markdown file and produces an
 * {@link AgentSpecification}.
 *
 * The orchestrator markdown file uses YAML frontmatter to declare metadata
 * (`id`, `role`, `tools`) and a plain-text body for the persona/system prompt.
 * This is a pure loader — it has no `pi` dependency and never touches the
 * live session. The resulting spec is the unified input handed to
 * {@link SessionAgent}, identical in shape to a subprocess agent's spec.
 *
 * @see docs/adr/0007-agent-hierarchy-subprocess-vs-in-session.md
 */
export class FlowSpecLoader {
  /**
   * Read and parse the orchestrator markdown file referenced by the flow
   * definition into an {@link AgentSpecification}.
   *
   * @param flow — The loaded flow definition.
   * @param flowDir — Directory containing the flow's JSON and markdown files.
   * @returns A {@link DynamicAgentSpecification} carrying the persona.
   */
  static async load(flow: FlowDefinition, flowDir: string): Promise<AgentSpecification> {
    const filePath = path.join(flowDir, flow.orchestrator.systemPrompt);
    const content = await fs.readFile(filePath, "utf-8");

    const { frontmatter, body } = parseFrontmatter<OrchestratorFrontmatter>(content);
    const role = frontmatter.role ?? DEFAULT_ROLE;

    return new DynamicAgentSpecification({
      id: frontmatter.id,
      role,
      systemPrompt: body.trim(),
      tools: frontmatter.tools,
    });
  }
}
