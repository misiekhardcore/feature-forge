import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import type { AgentSpawner } from "../../../pi-spawner";
import type { SubAgentContext, SubAgentResult } from "./types";

export abstract class SubAgent {
  abstract readonly name: string;
  protected abstract readonly promptFile: string;

  constructor(
    protected readonly promptDir: string,
    protected readonly spawner: AgentSpawner,
  ) {}

  /**
   * Execute this sub-agent with the given context.
   * Loads the prompt, replaces template variables, spawns pi -p, parses result.
   */
  async execute(ctx: SubAgentContext): Promise<SubAgentResult> {
    const prompt = this.buildPrompt(ctx);
    const spawnOptions: {
      cwd?: string;
      timeout?: number;
      forwardStderr: boolean;
    } = { forwardStderr: true };

    // Run in the worktree directory if one exists
    if (ctx.worktreePath) {
      spawnOptions.cwd = ctx.worktreePath;
    }

    const result = await this.spawner.run(prompt, spawnOptions);
    return this.parseResult(result);
  }

  // -----------------------------------------------------------------------
  // Prompt building
  // -----------------------------------------------------------------------

  /** Load the raw prompt text from disk. */
  private loadPrompt(): string {
    return readFileSync(join(this.promptDir, this.promptFile), "utf-8");
  }

  /** Build the final prompt by replacing template variables. */
  protected buildPrompt(ctx: SubAgentContext): string {
    let prompt = this.loadPrompt();
    prompt = prompt.replaceAll("{{issueUrl}}", ctx.issueRef);
    prompt = prompt.replaceAll("{{issueRef}}", ctx.issueRef);
    prompt = prompt.replaceAll("{{cycleN}}", String(ctx.cycleNumber));
    prompt = prompt.replaceAll("{{previousFindings}}", ctx.previousFindings ?? "");
    prompt = prompt.replaceAll("{{worktreePath}}", ctx.worktreePath ?? "");
    prompt = prompt.replaceAll("{{branch}}", ctx.branch ?? "");
    prompt = prompt.replaceAll("{{reviewFindings}}", ctx.reviewFindings ?? "");
    return prompt;
  }

  // -----------------------------------------------------------------------
  // Result parsing
  // -----------------------------------------------------------------------

  /** Parse the `## Handoff` section from stdout into a structured result. */
  protected parseResult(agentResult: AgentToolResult<{ exitCode?: number }>): SubAgentResult {
    const { content, details } = agentResult;
    const { exitCode } = details || {};
    const result: SubAgentResult = {
      status: exitCode === 0 ? "pass" : "fail",
      output: content.map((c) => (c.type === "text" ? c.text : "")).join(""),
    };

    const handoffMatch = content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
      .match(/## Handoff\n([\s\S]*?)(?:\n##|$)/);
    if (!handoffMatch) return result;

    const lines = handoffMatch[1].split("\n");
    for (const line of lines) {
      const trimmed = line.replace(/^- /, "").trim();

      // status: pass | fail
      const statusMatch = trimmed.match(/^status:\s*(pass|fail)/);
      if (statusMatch) {
        result.status = statusMatch[1] as "pass" | "fail";
        continue;
      }

      // worktreePath: <path>
      const wtMatch = trimmed.match(/^worktreePath:\s*(.+)/);
      if (wtMatch) {
        result.worktreePath = wtMatch[1].trim();
        continue;
      }

      // branch: <name>
      const branchMatch = trimmed.match(/^branch:\s*(.+)/);
      if (branchMatch) {
        result.branch = branchMatch[1].trim();
        continue;
      }

      // prUrl: <url>
      const prMatch = trimmed.match(/^prUrl:\s*(.+)/);
      if (prMatch) {
        result.prUrl = prMatch[1].trim();
        continue;
      }

      // summary: |, findings: |, remaining_issues: |, error: |
      for (const field of ["summary", "findings", "remaining_issues", "error"] as const) {
        const fieldMatch = trimmed.match(new RegExp(`^${field}:\\s*(?:\\|\\s*)?(.*)`));
        if (fieldMatch) {
          // Collect multi-line content
          const idx = lines.indexOf(line);
          const contentLines: string[] = [fieldMatch[1].trim()];
          for (let i = idx + 1; i < lines.length; i++) {
            const next = lines[i].replace(/^- /, "").trim();
            if (
              next.startsWith("- ") ||
              next.startsWith("status:") ||
              next.startsWith("worktreePath:") ||
              next.startsWith("branch:") ||
              next.startsWith("prUrl:") ||
              next.startsWith("summary:") ||
              next.startsWith("findings:") ||
              next.startsWith("remaining_issues:") ||
              next.startsWith("error:")
            ) {
              break;
            }
            if (next) contentLines.push(next);
          }
          // Map snake_case handoff fields to camelCase interface
          const resultField = field === "remaining_issues" ? "remainingIssues" : field;
          result[resultField] = contentLines.join("\n").trim();
          break;
        }
      }
    }

    return result;
  }
}
